import {
  buildClosedSeries,
  computeOrderQty,
  forecastRates,
  kstYesterday,
  stockoutDates,
  type DayPoint,
} from '../index'

const dates3 = ['2026-11-10', '2026-11-11', '2026-11-12']
const flat = (n: number, f: (i: number) => number): DayPoint[] =>
  Array.from({ length: n }, (_, i) => ({ date: `d${i}`, qty: f(i), stockout: false }))

describe('series', () => {
  it('kstYesterday', () => {
    expect(kstYesterday(new Date('2026-11-12T15:30:00Z'))).toBe('2026-11-12')
  })
  it('buildClosedSeries', () => {
    const s = buildClosedSeries({ '2026-11-12': 3 }, 3, new Date('2026-11-13T03:00:00Z'))
    expect(s.map((p) => p.date)).toEqual(dates3)
    expect(s.map((p) => p.qty)).toEqual([0, 0, 3])
  })
  it('stockoutDates: 판매한 날 시작재고>0 → 없음', () => {
    const r = stockoutDates({
      currentStock: 0,
      netByDate: { '2026-11-12': -5 },
      salesByDate: { '2026-11-12': 5 },
      dates: dates3,
    })
    expect(r.size).toBe(0)
  })
  it('stockoutDates: 재고 0·판매 0 → 3일 모두', () => {
    const r = stockoutDates({ currentStock: 0, netByDate: {}, salesByDate: {}, dates: dates3 })
    expect([...r].sort()).toEqual(dates3)
  })
})

describe('forecastRates', () => {
  it('매일 2개 → 모든 모델 2', () => {
    const r = forecastRates(
      flat(90, () => 2),
      30
    )
    const { CROSTON, ...rest } = r
    for (const v of Object.values(rest)) expect(v).toBeCloseTo(2, 1)
    expect(CROSTON).toBeCloseTo(1.9, 5) // SBA debias ×0.95 (croston.ts) — 브리프 toBeCloseTo(2,1) 불가
  })
  it('전부 0', () => {
    expect(
      Object.values(
        forecastRates(
          flat(90, () => 0),
          30
        )
      ).every((v) => v === 0)
    ).toBe(true)
  })
  it('전부 품절 → 0, finite', () => {
    const s = flat(90, () => 5).map((p) => ({ ...p, stockout: true }))
    for (const v of Object.values(forecastRates(s, 30))) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBe(0)
    }
  })
  it('MA30/MA90/BLEND', () => {
    const r = forecastRates(
      flat(90, (i) => (i >= 60 ? 4 : 1)),
      30
    )
    expect(r.MA30).toBe(4)
    expect(r.MA90).toBe(2)
    expect(r.MA_BLEND).toBeCloseTo(3.2, 10)
  })
})

describe('computeOrderQty', () => {
  const base = {
    dailyRate: 2,
    leadTimeDays: 20,
    targetCoverDays: 30,
    safetyStockQty: 10,
    onHandQty: 40,
    incomingQty: 0,
    roundUnit: 10,
  }
  it('기본', () => {
    const r = computeOrderQty(base)
    expect([r.gross, r.suggestedQty, r.roundedQty, r.checkStock]).toEqual([100, 70, 70, false])
  })
  it('음수 재고', () => {
    const r = computeOrderQty({ ...base, onHandQty: -30 })
    expect(r.checkStock).toBe(true)
    expect(r.suggestedQty).toBe(110)
  })
  it('rate 0 → coverDays null', () => {
    expect(computeOrderQty({ ...base, dailyRate: 0 }).coverDays).toBeNull()
  })
})
