import {
  diagnose,
  evaluateGate,
  judge,
  type ExcelOrder,
  type GateInput,
  type ObsLine,
  type ScanLine,
} from '../reconcile'
import { formatReport } from '../reconcile-run'

const NOW = new Date('2026-11-23T03:00:00.000Z') // 월요일 12:00 KST
const hAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

const obs = (o: Partial<ObsLine> & { key: string; orderId: string }): ObsLine => ({
  quantity: 1,
  status: 'PAYED',
  claimStatus: null,
  paidAt: hAgo(1),
  shippingDueAt: null,
  trackingNumber: null,
  dispatchedAt: null,
  deliveryKind: 'NORMAL',
  productName: '상품',
  target: 'L:1',
  ...o,
})
const scan = (key: string, orderId: string, quantity = 1, status = 'PAYED'): ScanLine => ({
  key,
  orderId,
  quantity,
  status,
})
const excel = (orderNumber: string, quantity = 1, extra: Partial<ExcelOrder> = {}): ExcelOrder => ({
  orderNumber,
  quantity,
  completed: false,
  targets: ['L:1'],
  channelLinked: true,
  ...extra,
})
const RULE = { field: 'externalOrderId' as const }

describe('judge', () => {
  it('전수에는 있으나 관측에 없는 행(주문의 일부 행 누락) = A', () => {
    const v = judge({
      now: NOW,
      obs: [obs({ key: 'L1', orderId: 'O1' })],
      scan: [scan('L1', 'O1'), scan('L2', 'O1')],
      excel: [],
      rule: RULE,
    })
    expect(v.A).toHaveLength(1)
  })

  it('행 수량 차이 = A', () => {
    const v = judge({
      now: NOW,
      obs: [obs({ key: 'L1', orderId: 'O1', quantity: 1 })],
      scan: [scan('L1', 'O1', 2)],
      excel: [],
      rule: RULE,
    })
    expect(v.A).toHaveLength(1)
  })

  it('엑셀에는 있는데 관측에 주문 자체가 없음 = A', () => {
    const v = judge({ now: NOW, obs: [], scan: [], excel: [excel('O9')], rule: RULE })
    expect(v.A).toHaveLength(1)
  })

  it('관측 수량 < 엑셀 수량 = A, 관측 > 엑셀 = C', () => {
    const lo = judge({
      now: NOW,
      obs: [obs({ key: 'L1', orderId: 'O1' })],
      scan: [],
      excel: [excel('O1', 2)],
      rule: RULE,
    })
    expect(lo.A).toHaveLength(1)
    const hi = judge({
      now: NOW,
      obs: [obs({ key: 'L1', orderId: 'O1', quantity: 3 })],
      scan: [],
      excel: [excel('O1', 2)],
      rule: RULE,
    })
    expect(hi.C).toHaveLength(1)
    expect(hi.A).toHaveLength(0)
  })

  it('한 주문이 여러 DelOrder 로 분할 등록되면 수량 합계로 비교(일치 시 이상 없음)', () => {
    const v = judge({
      now: NOW,
      obs: [obs({ key: 'L1', orderId: 'O1', quantity: 3 })],
      scan: [scan('L1', 'O1', 3)],
      excel: [excel('O1', 1), excel('o-1', 2)],
      rule: RULE,
    })
    expect(v).toEqual({ A: [], B: [], C: [], D: [], E: [] })
  })

  it('일대다: 관측 행 여러 개 합계 = 엑셀 한 건', () => {
    const v = judge({
      now: NOW,
      obs: [
        obs({ key: 'L1', orderId: 'O1', quantity: 1 }),
        obs({ key: 'L2', orderId: 'O1', quantity: 2 }),
      ],
      scan: [],
      excel: [excel('O1', 3)],
      rule: RULE,
    })
    expect(v.A.length + v.C.length).toBe(0)
  })

  it('상품 대응 불가(target null) = C', () => {
    const v = judge({
      now: NOW,
      obs: [obs({ key: 'L1', orderId: 'O1', target: null })],
      scan: [],
      excel: [excel('O1')],
      rule: RULE,
    })
    expect(v.C).toHaveLength(1)
  })

  it('B: 결제 후 영업일 1일 지났는데 엑셀 없음 / 지나기 전엔 아님', () => {
    const old = judge({
      now: NOW,
      obs: [obs({ key: 'L1', orderId: 'O1', paidAt: hAgo(72) })],
      scan: [],
      excel: [],
      rule: RULE,
    })
    expect(old.B).toHaveLength(1)
    const fresh = judge({
      now: NOW,
      obs: [obs({ key: 'L1', orderId: 'O1', paidAt: hAgo(2) })],
      scan: [],
      excel: [],
      rule: RULE,
    })
    expect(fresh.B).toHaveLength(0)
  })

  it('D: 채널 취소인데 엑셀 미완료 묶음', () => {
    const v = judge({
      now: NOW,
      obs: [obs({ key: 'L1', orderId: 'O1', status: 'CANCELED', claimStatus: 'CANCEL' })],
      scan: [],
      excel: [excel('O1', 1, { completed: false })],
      rule: RULE,
    })
    expect(v.D).toHaveLength(1)
  })

  it('E: 송장 없고 출고기한 지남', () => {
    const v = judge({
      now: NOW,
      obs: [obs({ key: 'L1', orderId: 'O1', shippingDueAt: hAgo(5) })],
      scan: [],
      excel: [excel('O1')],
      rule: RULE,
    })
    expect(v.E).toHaveLength(1)
  })

  it('도착보장(ARRIVAL_GUARANTEE)은 B 에서 제외', () => {
    const v = judge({
      now: NOW,
      obs: [obs({ key: 'L1', orderId: 'O1', paidAt: hAgo(72), deliveryKind: 'ARRIVAL_GUARANTEE' })],
      scan: [],
      excel: [],
      rule: RULE,
    })
    expect(v.B).toHaveLength(0)
  })

  it('매칭 키 규칙이 없으면 엑셀 대조는 C(일치로 치지 않음)', () => {
    const v = judge({
      now: NOW,
      obs: [obs({ key: 'L1', orderId: 'O1' })],
      scan: [],
      excel: [excel('O1')],
      rule: null,
    })
    expect(v.C).toHaveLength(1)
  })
})

describe('수집 상태 게이트 — 0건이어도 성공 아님', () => {
  type Scan = NonNullable<GateInput['lastScan']>
  const okScan = (over: Record<string, unknown> = {}): Scan => ({
    status: 'SUCCEEDED',
    finishedAt: hAgo(1),
    counts: {
      periodFrom: hAgo(24 * 7 + 1).toISOString(),
      periodTo: hAgo(1).toISOString(),
      structureOk: true,
      pagesRequested: 3,
      pagesReceived: 3,
      ...over,
    },
  })
  const base: GateInput = {
    now: NOW,
    recentObserve: [{ status: 'SUCCEEDED' }],
    cursor: { at: hAgo(0.5).toISOString(), catchingUp: false },
    lastScan: okScan(),
  }
  it('모두 정상이면 통과', () => expect(evaluateGate(base)).toEqual([]))
  it('최근 24시간 FAILED/PARTIAL', () => {
    expect(evaluateGate({ ...base, recentObserve: [{ status: 'FAILED' }] })).toContain(
      'observe_failed_recent'
    )
    expect(evaluateGate({ ...base, recentObserve: [{ status: 'PARTIAL' }] })).toContain(
      'observe_failed_recent'
    )
  })
  it('커서가 2시간 넘게 뒤처짐', () => {
    expect(
      evaluateGate({ ...base, cursor: { at: hAgo(3).toISOString(), catchingUp: false } })
    ).toContain('cursor_lag')
  })
  it('따라잡는 중·커서 없음', () => {
    expect(
      evaluateGate({ ...base, cursor: { at: hAgo(0.5).toISOString(), catchingUp: true } })
    ).toContain('catching_up')
    expect(evaluateGate({ ...base, cursor: null })).toContain('catching_up')
  })
  it('전수 조회 없음·실패·부분·구조 이상·기간 미달', () => {
    expect(evaluateGate({ ...base, lastScan: null })).toContain('scan_missing')
    expect(evaluateGate({ ...base, lastScan: { ...okScan(), status: 'FAILED' } })).toContain(
      'scan_incomplete'
    )
    expect(evaluateGate({ ...base, lastScan: { ...okScan(), status: 'PARTIAL' } })).toContain(
      'scan_incomplete'
    )
    expect(evaluateGate({ ...base, lastScan: okScan({ structureOk: false }) })).toContain(
      'scan_incomplete'
    )
    expect(evaluateGate({ ...base, lastScan: okScan({ pagesReceived: 2 }) })).toContain(
      'scan_incomplete'
    )
    expect(
      evaluateGate({ ...base, lastScan: okScan({ periodFrom: hAgo(48).toISOString() }) })
    ).toContain('scan_period_short')
  })
  it('전수 조회가 하루 넘게 오래됨', () => {
    expect(evaluateGate({ ...base, lastScan: { ...okScan(), finishedAt: hAgo(30) } })).toContain(
      'scan_missing'
    )
  })
})

describe('diagnose 모드 출력', () => {
  it('주문번호 원문·상품명이 리포트 문자열에 없다', () => {
    const report = diagnose({
      obs: [obs({ key: '2026112312345-1', orderId: '2026112312345', productName: '비밀상품' })],
      excel: [
        { orderNumber: '2026112312345', channelLinked: true },
        { orderNumber: 'AB-9988', channelLinked: false },
      ],
    })
    const text = formatReport([{ channel: '스토어(naver)', mode: 'diagnose', report }])
    expect(text).not.toContain('2026112312345')
    expect(text).not.toContain('AB-9988')
    expect(text).not.toContain('비밀상품')
    expect(text).toContain('N13')
    expect(report.matchRates.find((m) => m.field === 'externalOrderId')).toMatchObject({
      matched: 1,
      total: 1,
    })
  })
})
