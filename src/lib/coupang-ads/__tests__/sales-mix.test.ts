/** @jest-environment node */
import { buildSalesMix, judgeSalesMixStatus, weekStartKst } from '../sales-mix'

describe('judgeSalesMixStatus', () => {
  it('정확히 5% + 하루 1개 → organic', () => {
    expect(judgeSalesMixStatus({ revenue: 100000, adCost: 5000, salesQty: 30, days: 30 })).toBe(
      'organic'
    )
  })
  it('수량 미달 → neutral', () => {
    expect(judgeSalesMixStatus({ revenue: 100000, adCost: 5000, salesQty: 29, days: 30 })).toBe(
      'neutral'
    )
  })
  it('정확히 20% → dependent', () => {
    expect(judgeSalesMixStatus({ revenue: 100000, adCost: 20000, salesQty: 1, days: 30 })).toBe(
      'dependent'
    )
  })
  it('매출 음수·0', () => {
    expect(judgeSalesMixStatus({ revenue: -3000, adCost: 1000, salesQty: -1, days: 7 })).toBe(
      'dependent'
    )
    expect(judgeSalesMixStatus({ revenue: 0, adCost: 0, salesQty: 0, days: 7 })).toBe('neutral')
  })
})

describe('weekStartKst', () => {
  it('월요일 시작', () => {
    expect(weekStartKst('2026-10-29')).toBe('2026-10-26')
    expect(weekStartKst('2026-10-26')).toBe('2026-10-26')
    expect(weekStartKst('2026-11-01')).toBe('2026-10-26')
  })
})

describe('buildSalesMix', () => {
  const base = {
    from: '2026-10-01',
    to: '2026-10-07',
    current: { products: [], ads: [] },
    prev: { products: [], ads: [] },
    daily: { vendor: [], ads: [] },
    optionToProduct: new Map<string, string>([
      ['o1', 'p1'],
      ['o2', 'p1'],
    ]),
  }
  const p = (productId: string, revenue: number, salesQty = 1, productName = productId) => ({
    productId,
    productName,
    revenue,
    salesQty,
  })

  it('광고 옵션 합산 + 매핑 없음은 한 행', () => {
    const r = buildSalesMix({
      ...base,
      current: {
        products: [p('p1', 100000, 10)],
        ads: [
          { optionId: 'o1', adCost: 3000, adRevenue: 10000 },
          { optionId: 'o2', adCost: 2000, adRevenue: 5000 },
          { optionId: 'o9', adCost: 1000, adRevenue: 0 },
          { optionId: null, adCost: 500, adRevenue: 0 },
        ],
      },
    })
    expect(r.products.find((x) => x.productId === 'p1')!.adCost).toBe(5000)
    const none = r.products.find((x) => x.productId === null)!
    expect(none.adCost).toBe(1500)
    expect(none.productName).toBe('판매 데이터 없음')
    expect(r.kpi.adCost).toBe(6500)
    expect(r.products.reduce((s, x) => s + x.adCost, 0)).toBe(6500)
    expect(r.kpi.coupangAdRevenueShare).toBeCloseTo(0.15)
  })

  it('음수 매출 → adShare null, dependent', () => {
    const r = buildSalesMix({
      ...base,
      current: {
        products: [p('p1', -3000, -1)],
        ads: [{ optionId: 'o1', adCost: 1000, adRevenue: 0 }],
      },
    })
    expect(r.products[0].adShare).toBeNull()
    expect(r.products[0].status).toBe('dependent')
  })

  it('이전 기간에만 있는 상품', () => {
    const r = buildSalesMix({
      ...base,
      prev: { products: [p('p2', 5000, 1, '이전상품')], ads: [] },
    })
    const row = r.products.find((x) => x.productId === 'p2')!
    expect(row.revenue).toBe(0)
    expect(row.productName).toBe('이전상품')
    expect(row.revenueChangePct).toBe(-100)
  })

  it('adShare 변화 pp', () => {
    const r = buildSalesMix({
      ...base,
      current: {
        products: [p('p1', 100000)],
        ads: [{ optionId: 'o1', adCost: 20000, adRevenue: 0 }],
      },
      prev: { products: [p('p1', 100000)], ads: [{ optionId: 'o2', adCost: 10000, adRevenue: 0 }] },
    })
    expect(r.products[0].prevAdShare).toBeCloseTo(0.1)
    expect(r.products[0].adShareDeltaPp).toBeCloseTo(10)
    expect(r.products[0].revenueChangePct).toBe(0)
  })

  it('days / missingDays', () => {
    const r = buildSalesMix({
      ...base,
      daily: {
        vendor: ['01', '02', '03', '04', '05'].map((d) => ({ date: `2026-10-${d}`, revenue: 1 })),
        ads: [],
      },
    })
    expect(r.days).toBe(7)
    expect(r.missingDays).toBe(2)
  })

  it('weeks 오름차순, 합계 = kpi', () => {
    const r = buildSalesMix({
      ...base,
      from: '2026-10-01',
      to: '2026-10-14',
      current: { products: [p('p1', 600)], ads: [{ optionId: 'o1', adCost: 60, adRevenue: 0 }] },
      daily: {
        vendor: [
          { date: '2026-10-12', revenue: 300 },
          { date: '2026-10-01', revenue: 100 },
          { date: '2026-10-05', revenue: 200 },
        ],
        ads: [
          { date: '2026-10-12', adCost: 30 },
          { date: '2026-10-05', adCost: 30 },
        ],
      },
    })
    expect(r.weeks.map((w) => w.weekStart)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12'])
    expect(r.weeks.reduce((s, w) => s + w.revenue, 0)).toBe(r.kpi.revenue)
    expect(r.weeks.reduce((s, w) => s + w.adCost, 0)).toBe(r.kpi.adCost)
  })

  it('정렬: 매출 내림차순, null 행 끝', () => {
    const r = buildSalesMix({
      ...base,
      current: {
        products: [p('a', 10), p('b', 500), p('c', 100)],
        ads: [{ optionId: 'o9', adCost: 1, adRevenue: 0 }],
      },
    })
    expect(r.products.map((x) => x.productId)).toEqual(['b', 'c', 'a', null])
  })

  it('현재 광고가 이전 기간에만 판매된 상품에 귀속', () => {
    const r = buildSalesMix({
      ...base,
      current: { products: [], ads: [{ optionId: 'o1', adCost: 700, adRevenue: 0 }] },
      prev: { products: [p('p1', 5000, 1, '이전상품')], ads: [] },
    })
    const row = r.products.find((x) => x.productId === 'p1')!
    expect(row.adCost).toBe(700)
    expect(row.status).toBe('dependent')
    expect(row.productName).toBe('이전상품')
    expect(r.products.find((x) => x.productId === null)).toBeUndefined()
    expect(r.kpi.adCost).toBe(700)
  })

  it('이전 광고가 현재 기간에만 판매된 상품에 귀속', () => {
    const r = buildSalesMix({
      ...base,
      current: { products: [p('p1', 1000, 1, '현재상품')], ads: [] },
      prev: { products: [], ads: [{ optionId: 'o1', adCost: 400, adRevenue: 0 }] },
    })
    const row = r.products.find((x) => x.productId === 'p1')!
    expect(row.prevAdShare).toBeNull()
    expect(row.productName).toBe('현재상품')
    expect(r.products.find((x) => x.productId === null)).toBeUndefined()
  })
})
