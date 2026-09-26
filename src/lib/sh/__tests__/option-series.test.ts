import {
  resolveOptionSeries,
  OTHER_SERIES_ID,
  type OptionCatalogProduct,
} from '@/lib/sh/sales-analytics'

const product = (i: number, qty: number, revenue: number): OptionCatalogProduct => ({
  productId: `p${i}`,
  productName: `상품${i}`,
  productGroupId: null,
  qty,
  revenue,
  options: [{ optionId: `o${i}` } as OptionCatalogProduct['options'][number]],
})

describe('resolveOptionSeries — 미선택 기본 시리즈', () => {
  const none = { productIds: [], optionIds: [] }

  it('지표 상위 7개 + 기타(나머지 옵션 전부)', () => {
    // 수량은 i 오름차순, 매출은 내림차순 → 지표에 따라 상위가 뒤집힌다
    const catalog = Array.from({ length: 10 }, (_, i) => product(i, i, 100 - i))
    const byQty = resolveOptionSeries(none, catalog, 'qty')
    expect(byQty.map((s) => s.id)).toEqual([
      'p9',
      'p8',
      'p7',
      'p6',
      'p5',
      'p4',
      'p3',
      OTHER_SERIES_ID,
    ])
    expect(byQty.at(-1)!.optionIds.sort()).toEqual(['o0', 'o1', 'o2'])
    expect(resolveOptionSeries(none, catalog, 'revenue')[0].id).toBe('p0')
  })

  it('7개 이하면 기타 없음', () => {
    const series = resolveOptionSeries(none, [product(1, 1, 1), product(2, 2, 2)], 'qty')
    expect(series.map((s) => s.id)).toEqual(['p2', 'p1'])
  })
})
