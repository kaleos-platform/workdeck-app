/** @jest-environment node */
import {
  computeLiabilityPending,
  watermarkOf,
  type LiabilityWatermark,
  type RepaymentTxn,
} from '../liability'

const dt = (iso: string) => new Date(iso)

const liab = (id: string, createdAt: string, balanceAsOf: string | null): LiabilityWatermark => ({
  id,
  createdAt: dt(createdAt),
  balanceAsOf: balanceAsOf ? dt(balanceAsOf) : null,
})

const txn = (
  liabilityId: string | null,
  amount: number,
  txnDate: string,
  direction: 'IN' | 'OUT' = 'OUT'
): RepaymentTxn => ({ liabilityId, amount, txnDate: dt(txnDate), direction })

describe('watermarkOf', () => {
  test('balanceAsOf 우선, 없으면 createdAt', () => {
    expect(watermarkOf(liab('a', '2026-01-01', '2026-03-01')).toISOString()).toBe(
      dt('2026-03-01').toISOString()
    )
    expect(watermarkOf(liab('a', '2026-01-01', null)).toISOString()).toBe(
      dt('2026-01-01').toISOString()
    )
  })
})

describe('computeLiabilityPending', () => {
  test('워터마크 이후 연결 OUT 거래만 집계', () => {
    const liabilities = [liab('L1', '2026-01-01', '2026-02-01')]
    const repayments = [
      txn('L1', 500_000, '2026-01-15'), // 워터마크 이전 → 제외
      txn('L1', 500_000, '2026-03-10'), // 이후 → 포함
      txn('L1', 500_000, '2026-04-10'), // 이후 → 포함
    ]
    const pending = computeLiabilityPending(liabilities, repayments).get('L1')!
    expect(pending.count).toBe(2)
    expect(pending.sum).toBe(1_000_000)
    expect(pending.throughDate).toBe(dt('2026-04-10').toISOString())
  })

  test('balanceAsOf 없으면 createdAt 워터마크 — 생성 이전 상환 이중집계 방지', () => {
    const liabilities = [liab('L1', '2026-03-01', null)]
    const repayments = [
      txn('L1', 700_000, '2026-02-20'), // 생성 이전 → 제외
      txn('L1', 700_000, '2026-03-20'), // 이후 → 포함
    ]
    const pending = computeLiabilityPending(liabilities, repayments).get('L1')!
    expect(pending.count).toBe(1)
    expect(pending.sum).toBe(700_000)
  })

  test('IN 거래·미연결·다른 부채는 제외', () => {
    const liabilities = [liab('L1', '2026-01-01', null), liab('L2', '2026-01-01', null)]
    const repayments = [
      txn('L1', 100, '2026-05-01', 'IN'), // IN → 제외
      txn(null, 100, '2026-05-01'), // 미연결 → 제외
      txn('L2', 300, '2026-05-01'), // 다른 부채
      txn('L1', 200, '2026-05-01'), // L1 포함
    ]
    const map = computeLiabilityPending(liabilities, repayments)
    expect(map.get('L1')!.sum).toBe(200)
    expect(map.get('L1')!.count).toBe(1)
    expect(map.get('L2')!.sum).toBe(300)
  })

  test('경계 — 워터마크와 정확히 같은 시각은 제외(초과만 포함)', () => {
    const liabilities = [liab('L1', '2026-01-01', '2026-03-01T00:00:00.000Z')]
    const repayments = [txn('L1', 100, '2026-03-01T00:00:00.000Z')]
    expect(computeLiabilityPending(liabilities, repayments).get('L1')!.count).toBe(0)
  })

  test('감지 없음 → count 0 · throughDate null', () => {
    const liabilities = [liab('L1', '2026-01-01', null)]
    const pending = computeLiabilityPending(liabilities, []).get('L1')!
    expect(pending).toEqual({ count: 0, sum: 0, throughDate: null })
  })
})
