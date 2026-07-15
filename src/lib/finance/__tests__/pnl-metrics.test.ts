/**
 * pnl-metrics 순수 함수 유닛 테스트 — 손익 지표 산식·방향·엣지케이스.
 */
import { computePnlMetrics, type PnlTxnFact } from '@/lib/finance/pnl-metrics'

const BUCKETS = ['2026-06', '2026-07']

function fact(p: Partial<PnlTxnFact> & { bucket: string; amount: number }): PnlTxnFact {
  return { direction: 'OUT', flowRole: null, groupLabel: null, ...p }
}

describe('computePnlMetrics', () => {
  it('기본 산식: 매출총이익/공헌이익/영업이익/공헌이익율/BEP', () => {
    const facts: PnlTxnFact[] = [
      // 매출 1,000 (IN, MERCH_SALES)
      fact({ bucket: '2026-06', amount: 1000, direction: 'IN', flowRole: 'MERCH_SALES' }),
      // 매출원가 400 (변동)
      fact({ bucket: '2026-06', amount: 400, flowRole: 'COGS', groupLabel: '변동' }),
      // 영업비용: 변동 100 + 고정 200
      fact({ bucket: '2026-06', amount: 100, flowRole: 'OPEX', groupLabel: '변동' }),
      fact({ bucket: '2026-06', amount: 200, flowRole: 'OPEX', groupLabel: '고정' }),
      // 금융비용 50 · 미지정 30 → 지표 제외
      fact({ bucket: '2026-06', amount: 50, flowRole: 'FINANCING_COST', groupLabel: '고정' }),
      fact({ bucket: '2026-06', amount: 30, flowRole: null }),
    ]
    const m = computePnlMetrics(facts, BUCKETS)

    expect(m.revenue.total).toBe(1000)
    expect(m.cogs.total).toBe(400)
    expect(m.opex.total).toBe(300)
    // 변동비 = 400 + 100 = 500
    expect(m.variableCost.total).toBe(500)
    // 고정비 = (400+300) − 500 = 200
    expect(m.fixedCost.total).toBe(200)
    // 매출총이익 = 1000 − 400 = 600
    expect(m.grossProfit.total).toBe(600)
    // 공헌이익 = 1000 − 500 = 500
    expect(m.contributionMargin.total).toBe(500)
    // 공헌이익율 = 500/1000 = 50%
    expect(m.contributionMarginRatio.total).toBe(50)
    // 영업이익 = 1000 − 400 − 300 = 300 (금융·미지정 제외)
    expect(m.operatingIncome.total).toBe(300)
    // 매출총이익율 = 600/1000 = 60%, 영업이익율 = 300/1000 = 30%
    expect(m.grossMarginRatio.total).toBe(60)
    expect(m.operatingMarginRatio.total).toBe(30)
    // BEP = 고정비 / 공헌이익율 = 200 / 0.5 = 400
    expect(m.breakEvenSales.total).toBe(400)
  })

  it('방향 net: 매출 카테고리 환불(OUT)은 매출을 차감', () => {
    const facts: PnlTxnFact[] = [
      fact({ bucket: '2026-06', amount: 1000, direction: 'IN', flowRole: 'MERCH_SALES' }),
      fact({ bucket: '2026-06', amount: 300, direction: 'OUT', flowRole: 'MERCH_SALES' }),
    ]
    const m = computePnlMetrics(facts, BUCKETS)
    expect(m.revenue.total).toBe(700)
  })

  it('미태그 영업 리프는 변동비 제외(고정 취급)', () => {
    const facts: PnlTxnFact[] = [
      fact({ bucket: '2026-06', amount: 1000, direction: 'IN', flowRole: 'MERCH_SALES' }),
      fact({ bucket: '2026-06', amount: 200, flowRole: 'OPEX', groupLabel: null }),
    ]
    const m = computePnlMetrics(facts, BUCKETS)
    expect(m.variableCost.total).toBe(0)
    expect(m.contributionMargin.total).toBe(1000)
    expect(m.fixedCost.total).toBe(200)
  })

  it('매출 0이면 공헌이익율·BEP는 null', () => {
    const facts: PnlTxnFact[] = [
      fact({ bucket: '2026-06', amount: 200, flowRole: 'OPEX', groupLabel: '고정' }),
    ]
    const m = computePnlMetrics(facts, BUCKETS)
    expect(m.contributionMarginRatio.total).toBeNull()
    expect(m.grossMarginRatio.total).toBeNull()
    expect(m.operatingMarginRatio.total).toBeNull()
    expect(m.breakEvenSales.total).toBeNull()
    expect(m.contributionMarginRatio.values['2026-06']).toBeNull()
    expect(m.breakEvenSales.values['2026-06']).toBeNull()
  })

  it('버킷 밖 거래는 무시', () => {
    const facts: PnlTxnFact[] = [
      fact({ bucket: '2025-01', amount: 9999, direction: 'IN', flowRole: 'MERCH_SALES' }),
    ]
    const m = computePnlMetrics(facts, BUCKETS)
    expect(m.revenue.total).toBe(0)
  })

  it('버킷별 값 합 = total', () => {
    const facts: PnlTxnFact[] = [
      fact({ bucket: '2026-06', amount: 1000, direction: 'IN', flowRole: 'MERCH_SALES' }),
      fact({ bucket: '2026-07', amount: 500, direction: 'IN', flowRole: 'MERCH_SALES' }),
      fact({ bucket: '2026-06', amount: 400, flowRole: 'COGS', groupLabel: '변동' }),
    ]
    const m = computePnlMetrics(facts, BUCKETS)
    expect(m.revenue.values['2026-06'] + m.revenue.values['2026-07']).toBe(m.revenue.total)
    expect(m.grossProfit.values['2026-06']).toBe(600)
    expect(m.grossProfit.values['2026-07']).toBe(500)
  })
})
