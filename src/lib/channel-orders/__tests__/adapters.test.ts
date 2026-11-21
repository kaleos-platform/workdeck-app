import { parseOrdersPage, Cafe24StructureError, errorCodeOf } from '../adapters/cafe24'
import { planWindows, scanWindows } from '../operations'
import { ChannelOrderError, OrderLineInputSchema, kstMidnight } from '../types'
import { keyPattern, normalizeOrderNumber, rawHashOf } from '../normalize'

const NOW = new Date('2026-11-23T03:00:00.000Z')
const DAY = 86_400_000

describe('카페24 응답 → 행 변환', () => {
  const page = {
    orders: [
      {
        order_id: '20261123-0000001',
        order_date: '2026-11-23T10:00:00+09:00',
        payment_date: '2026-11-23T10:01:00+09:00',
        canceled: 'F',
        buyer_name: '홍길동',
        items: [
          {
            order_item_code: '20261123-0000001-01',
            product_name: 'A',
            option_value: '빨강',
            quantity: 2,
            order_status: 'N10',
            tracking_no: null,
          },
          {
            order_item_code: '20261123-0000001-02',
            product_name: 'B',
            quantity: 1,
            order_status: 'C10',
          },
        ],
      },
    ],
  }
  it('items 를 행 키 단위로 펼치고 개인정보 필드는 가져오지 않는다', () => {
    const { rows, orderCount } = parseOrdersPage(page)
    expect(orderCount).toBe(1)
    expect(rows.map((r) => r.line.externalLineKey)).toEqual([
      '20261123-0000001-01',
      '20261123-0000001-02',
    ])
    expect(rows[0].line.quantity).toBe(2)
    expect(rows[1].line.claimStatus).toBe('CANCEL')
    expect(OrderLineInputSchema.safeParse(rows[0].line).success).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('홍길동')
  })
  it('구조가 다르면 빈 목록이 아니라 실패한다', () => {
    expect(() => parseOrdersPage({})).toThrow(Cafe24StructureError)
    expect(() =>
      parseOrdersPage({ orders: [{ order_id: 'x', order_date: '2026-11-23T10:00:00+09:00' }] })
    ).toThrow(Cafe24StructureError)
    expect(() =>
      parseOrdersPage({
        orders: [
          {
            order_id: 'x',
            order_date: '2026-11-23T10:00:00+09:00',
            items: [{ order_item_code: 'a' }],
          },
        ],
      })
    ).toThrow(Cafe24StructureError)
  })
  it('구매자 입력 텍스트(additional_option_value)는 저장하지 않고 option_value 만 저장한다', () => {
    const p = {
      orders: [
        {
          order_id: 'x',
          payment_date: '2026-11-23T10:00:00+09:00',
          items: [
            {
              order_item_code: 'x-1',
              product_name: 'A',
              option_value: '빨강',
              additional_option_value: '받는분 010-1234-5678 서울시 어딘가',
              quantity: 1,
              order_status: 'N10',
            },
          ],
        },
      ],
    }
    const { rows } = parseOrdersPage(p)
    expect(rows[0].line.optionText).toBe('빨강')
    expect(JSON.stringify(rows)).not.toContain('010-1234')
    expect(JSON.stringify(rows)).not.toContain('additional')
  })
  it('긴 문자열은 스키마 한도에 맞춰 잘라 저장해 ingest 검증을 통과한다', () => {
    const long = (n: number) => 'ㄱ'.repeat(n)
    const { rows } = parseOrdersPage({
      orders: [
        {
          order_id: 'x',
          payment_date: '2026-11-23T10:00:00+09:00',
          items: [
            {
              order_item_code: 'x-1',
              product_name: long(900),
              option_value: long(900),
              quantity: 1,
              order_status: 'N10',
              tracking_no: long(300),
              shipping_company_code: long(300),
            },
          ],
        },
      ],
    })
    const r = OrderLineInputSchema.safeParse(rows[0].line)
    expect(r.success).toBe(true)
    expect(rows[0].line.productName).toHaveLength(500)
  })
  it('빈 orders 배열은 정상 빈 페이지', () => {
    expect(parseOrdersPage({ orders: [] })).toEqual({ rows: [], orderCount: 0 })
  })
})

describe('조회 창 계산', () => {
  it('커서가 없으면 14일 전부터 1일 단위로 쪼갠다', () => {
    const w = planWindows('cafe24', null, NOW)
    expect(w).toHaveLength(14)
    expect(w[0].from.getTime()).toBe(NOW.getTime() - 14 * DAY)
    expect(w.at(-1)?.to.getTime()).toBe(NOW.getTime())
    for (let i = 1; i < w.length; i++) expect(w[i].from.getTime()).toBe(w[i - 1].to.getTime())
  })
  it('장애 후 따라잡기: 커서가 오래되면 여러 창, maxWindows 로 한 번에 처리할 양 제한', () => {
    const cursor = { at: new Date(NOW.getTime() - 10 * DAY).toISOString(), catchingUp: false }
    expect(planWindows('naver', cursor, NOW).length).toBeGreaterThan(9)
    expect(planWindows('naver', cursor, NOW, 3)).toHaveLength(3)
  })
  it('정상 주기: 네이버는 커서−1시간부터 한 창', () => {
    const cursor = { at: new Date(NOW.getTime() - 30 * 60_000).toISOString(), catchingUp: false }
    const w = planWindows('naver', cursor, NOW)
    expect(w).toHaveLength(1)
    expect(w[0].from.getTime()).toBe(NOW.getTime() - 90 * 60_000)
  })
})

describe('카페24 증분 겹침 8일·전수 창', () => {
  it('정상 주기에도 커서−8일부터 다시 읽어 5일 전 결제 행의 상태 변화를 따라잡는다', () => {
    const cursor = { at: new Date(NOW.getTime() - 30 * 60_000).toISOString(), catchingUp: false }
    const w = planWindows('cafe24', cursor, NOW)
    expect(w[0].from.getTime()).toBeLessThanOrEqual(NOW.getTime() - 8 * DAY)
    // 5일 전 시각이 어느 한 창에 들어간다
    const five = NOW.getTime() - 5 * DAY
    expect(w.some((x) => x.from.getTime() <= five && five < x.to.getTime())).toBe(true)
  })
  it('전수 창: KST 자정 정렬 일자 창, 겹침 없음, W 시작은 자정 기준 7일 전', () => {
    const w = scanWindows(NOW) // NOW = 월 12:00 KST
    const from = kstMidnight(NOW) - 7 * DAY
    expect(w).toHaveLength(8)
    expect(w[0].from.getTime()).toBe(from)
    expect(w.at(-1)?.to.getTime()).toBe(NOW.getTime())
    for (let i = 1; i < w.length; i++) {
      expect(w[i].from.getTime()).toBe(from + i * DAY)
      expect(w[i].from.getTime()).toBeGreaterThan(w[i - 1].to.getTime())
    }
  })
})

describe('오류 코드', () => {
  it('ChannelOrderError 의 code 를 lease_lost 로 뭉개지 않고 그대로 낸다', () => {
    expect(errorCodeOf(new ChannelOrderError('invalid', 'x'))).toBe('invalid')
    expect(errorCodeOf(new ChannelOrderError('lease_lost', 'x'))).toBe('lease_lost')
    expect(errorCodeOf(new ChannelOrderError('busy', 'x'))).toBe('busy')
  })
})

describe('정규화·검증', () => {
  it('개인정보 필드가 있으면 ingest 스키마가 거부한다', () => {
    const ok = {
      externalLineKey: 'k',
      externalOrderId: 'o',
      paidAt: '2026-11-23T01:00:00Z',
      productName: 'p',
      quantity: 1,
      channelStatus: 'S',
      deliveryKind: 'NORMAL',
    }
    expect(OrderLineInputSchema.safeParse(ok).success).toBe(true)
    for (const pii of ['recipientName', 'phone', 'address']) {
      expect(OrderLineInputSchema.safeParse({ ...ok, [pii]: 'x' }).success).toBe(false)
    }
  })
  it('rawHash 는 같은 내용이면 같고 상태가 바뀌면 달라진다', () => {
    const l = {
      externalLineKey: 'k',
      externalOrderId: 'o',
      paidAt: '2026-11-23T01:00:00Z',
      productName: 'p',
      quantity: 1,
      channelStatus: 'S',
      deliveryKind: 'NORMAL',
    }
    expect(rawHashOf(l)).toBe(rawHashOf({ ...l, paidAt: '2026-11-23T10:00:00+09:00' }))
    expect(rawHashOf(l)).not.toBe(rawHashOf({ ...l, channelStatus: 'T' }))
  })
  it('주문번호 정규화와 형식 패턴', () => {
    expect(normalizeOrderNumber(' ab-12 3 ')).toBe('AB123')
    expect(keyPattern('20261123-0000001')).toBe('N8-N7')
    expect(keyPattern('A1234')).toBe('A1N4')
  })
})
