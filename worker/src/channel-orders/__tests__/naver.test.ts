/** @jest-environment node */
import { StructureError, type Hooks, type OrderLine, type ScanLine } from '../common.js'
import {
  observeNaver,
  parseQueryRows,
  parseScanPage,
  parseStatusPage,
  scanNaver,
  type NaverHttp,
} from '../naver.js'

const TRACE = { timestamp: '2026-11-24T00:00:00Z', traceId: 'abc' }
const statusRow = (id: string, changed = '2026-11-24T10:00:00.000+09:00') => ({
  orderId: `O-${id}`,
  productOrderId: id,
  lastChangedType: 'PAYED',
  paymentDate: '2026-11-24T09:00:00.000+09:00',
  lastChangedDate: changed,
  productOrderStatus: 'PAYED',
})
const queryRow = (id: string, over: Record<string, unknown> = {}) => ({
  order: {
    orderId: `O-${id}`,
    paymentDate: '2026-11-24T09:00:00.000+09:00',
    ordererName: '홍길동',
    ordererTel: '010-1111-2222',
  },
  productOrder: {
    productOrderId: id,
    productName: '상품',
    productOption: '옵션: 빨강',
    quantity: 2,
    productOrderStatus: 'PAYED',
    deliveryAttributeType: 'NORMAL',
    shippingDueDate: '2026-11-26T23:59:59.000+09:00',
    claimType: 'CANCEL',
    claimStatus: 'CANCEL_REQUEST',
    shippingAddress: { name: '수령인A', baseAddress: '서울시 비밀구' },
    ...over,
  },
  delivery: {
    deliveryCompany: 'CJGLS',
    trackingNumber: '123',
    sendDate: '2026-11-24T11:00:00+09:00',
  },
})
const W = [{ from: '2026-11-23T15:00:00.000Z', to: '2026-11-24T15:00:00.000Z' }]

function hooks<L>() {
  const pages: L[][] = []
  const state = { requested: 0 }
  const h: Hooks<L> = {
    request: () => void state.requested++,
    check: () => undefined,
    page: async (lines) => void pages.push(lines),
  }
  return { h, pages, state }
}

describe('네이버 응답 구조 규칙', () => {
  it('data 없음 + traceId 있음 = 0건(정상)', () => {
    expect(parseStatusPage(TRACE)).toEqual({ items: [], more: null })
    expect(parseScanPage(TRACE)).toEqual({ lines: [], hasNext: false })
  })
  it('data·traceId 둘 다 없거나 data 형태 이상 → StructureError', () => {
    expect(() => parseStatusPage({})).toThrow(StructureError)
    expect(() => parseStatusPage({ ...TRACE, data: 'x' })).toThrow(StructureError)
    expect(() => parseStatusPage({ ...TRACE, data: { lastChangeStatuses: {} } })).toThrow(
      StructureError
    )
    expect(() => parseScanPage({ ...TRACE, data: { contents: [] } })).toThrow(StructureError) // pagination 없음
    expect(() =>
      parseScanPage({ ...TRACE, data: { contents: [], pagination: { hasNext: 'yes' } } })
    ).toThrow(StructureError)
  })
  it('필수 필드 하나라도 없으면 페이지 전체 실패(버리지 않는다)', () => {
    const none = new Map<string, string | null>()
    for (const [k, loc] of [
      ['productName', 'po'],
      ['productOrderStatus', 'po'],
      ['quantity', 'po'],
      ['productOrderId', 'po'],
    ] as const) {
      const row = queryRow('P1')
      delete (row[loc === 'po' ? 'productOrder' : 'order'] as Record<string, unknown>)[k]
      expect(() => parseQueryRows({ data: [queryRow('P0'), row] }, none)).toThrow(StructureError)
    }
    const noPay = queryRow('P1')
    delete (noPay.order as Record<string, unknown>).paymentDate
    expect(() => parseQueryRows({ data: [noPay] }, none)).toThrow(StructureError)
  })
})

describe('네이버 행 변환', () => {
  it('화이트리스트만 담고 개인정보는 없다', () => {
    const [row] = parseQueryRows(
      { data: [queryRow('P1')] },
      new Map([['P1', '2026-11-24T01:00:00.000Z']])
    )
    expect(row).toEqual({
      externalLineKey: 'P1',
      externalOrderId: 'O-P1',
      paidAt: '2026-11-24T00:00:00.000Z',
      productName: '상품',
      optionText: '옵션: 빨강',
      quantity: 2,
      channelStatus: 'PAYED',
      claimStatus: 'CANCEL_REQUEST',
      deliveryKind: 'NORMAL',
      shippingDueAt: '2026-11-26T14:59:59.000Z',
      carrierCode: 'CJGLS',
      trackingNumber: '123',
      dispatchedAt: '2026-11-24T02:00:00.000Z',
      sourceChangedAt: '2026-11-24T01:00:00.000Z',
    })
    const json = JSON.stringify(row)
    for (const pii of ['홍길동', '010-1111', '수령인A', '비밀구']) expect(json).not.toContain(pii)
  })
  it('긴 문자열은 스키마 한도로 자르되 키는 자르지 않는다', () => {
    const [row] = parseQueryRows(
      { data: [queryRow('K'.repeat(250), { productName: 'N'.repeat(900) })] },
      new Map()
    )
    expect(row.productName).toHaveLength(500)
    expect(row.externalLineKey).toHaveLength(250)
  })
})

describe('observeNaver', () => {
  it('변경 목록 이어받기(more) · 같은 주문 중복은 1건 · 장(페이지)마다 page 훅', async () => {
    const calls: string[] = []
    const http: NaverHttp = async (method, path, params, body) => {
      calls.push(`${method} ${path}`)
      if (path.endsWith('last-changed-statuses')) {
        if (!params?.moreSequence)
          return {
            ...TRACE,
            data: {
              lastChangeStatuses: [statusRow('A'), statusRow('A'), statusRow('B')],
              more: { moreFrom: '2026-11-24T10:00:00.000+09:00', moreSequence: '7' },
            },
          }
        expect(params.lastChangedFrom).toBe('2026-11-24T10:00:00.000+09:00')
        return { ...TRACE, data: { lastChangeStatuses: [statusRow('C')] } }
      }
      const ids = (body as { productOrderIds: string[] }).productOrderIds
      return { ...TRACE, data: ids.map((id) => queryRow(id)) }
    }
    const { h, pages, state } = hooks<OrderLine>()
    await observeNaver(http, W, h)
    expect(state.requested).toBe(2)
    expect(pages.map((p) => p.map((r) => r.externalLineKey))).toEqual([['A', 'B'], ['C']])
  })
  it('빈 변경 목록도 1페이지(빈 배열)로 센다', async () => {
    const { h, pages, state } = hooks<OrderLine>()
    await observeNaver(async () => TRACE, W, h)
    expect(state.requested).toBe(1)
    expect(pages).toEqual([[]])
  })
  it('300건 초과는 query 를 300개씩 나눠 한 페이지로 합친다', async () => {
    const ids = Array.from({ length: 650 }, (_, i) => `P${i}`)
    const sizes: number[] = []
    const http: NaverHttp = async (_m, path, _p, body) => {
      if (path.endsWith('last-changed-statuses'))
        return { ...TRACE, data: { lastChangeStatuses: ids.map((i) => statusRow(i)) } }
      const q = (body as { productOrderIds: string[] }).productOrderIds
      sizes.push(q.length)
      return { ...TRACE, data: q.map((id) => queryRow(id)) }
    }
    const { h, pages } = hooks<OrderLine>()
    await observeNaver(http, W, h)
    expect(sizes).toEqual([300, 300, 50])
    expect(pages).toHaveLength(1)
    expect(pages[0]).toHaveLength(650)
  })
  it('query 응답 건수가 요청보다 적으면 실패하고 그 페이지는 적재하지 않는다', async () => {
    const http: NaverHttp = async (_m, path) =>
      path.endsWith('last-changed-statuses')
        ? { ...TRACE, data: { lastChangeStatuses: [statusRow('A'), statusRow('B')] } }
        : { ...TRACE, data: [queryRow('A')] }
    const { h, pages, state } = hooks<OrderLine>()
    await expect(observeNaver(http, W, h)).rejects.toThrow(StructureError)
    expect(state.requested).toBe(1)
    expect(pages).toHaveLength(0)
  })
})

describe('scanNaver', () => {
  it('hasNext 동안 페이지를 넘기고 ScanLine 을 만든다', async () => {
    const http: NaverHttp = async (_m, _p, params) => ({
      ...TRACE,
      data: {
        contents: [
          {
            productOrderId: `P${params?.page}`,
            content: {
              order: { orderId: 'O1', paymentDate: '2026-11-24T09:00:00.000+09:00' },
              productOrder: {
                productOrderId: `P${params?.page}`,
                quantity: 1,
                productOrderStatus: 'PAYED',
              },
            },
          },
        ],
        pagination: { hasNext: params?.page !== '3' },
      },
    })
    const { h, pages, state } = hooks<ScanLine>()
    await scanNaver(http, W, h)
    expect(state.requested).toBe(3)
    expect(pages.flat().map((l) => l.externalLineKey)).toEqual(['P1', 'P2', 'P3'])
  })
})
