// @jest-environment node

import { calculateProductUnitCosts, type ProductionCostRun } from '../production-cost-allocation'

function run(overrides: Partial<ProductionCostRun> = {}): ProductionCostRun {
  return {
    id: 'run-1',
    totalCost: null,
    items: [],
    costs: [],
    ...overrides,
  }
}

describe('calculateProductUnitCosts', () => {
  test('actual quantity 비율로 생산비를 배분하고 마케팅비는 대상 상품에만 귀속한다', () => {
    const result = calculateProductUnitCosts([
      run({
        items: [
          { productId: 'p1', quantity: 120, stockedInQty: 100 },
          { productId: 'p2', quantity: 50, stockedInQty: 50 },
        ],
        costs: [
          {
            amount: 1_650_000,
            vatIncluded: true,
            category: 'MATERIAL',
            targetProductId: null,
          },
          {
            amount: 330_000,
            vatIncluded: true,
            category: 'MARKETING',
            targetProductId: 'p1',
          },
        ],
      }),
    ])

    expect(result.get('p1')?.productionUnitCost).toBeCloseTo(10_000, 10)
    expect(result.get('p1')?.marketingUnitCost).toBeCloseTo(3_000, 10)
    expect(result.get('p1')?.totalUnitCost).toBeCloseTo(13_000, 10)
    expect(result.get('p1')?.runCount).toBe(1)
    expect(result.get('p2')?.productionUnitCost).toBeCloseTo(10_000, 10)
    expect(result.get('p2')?.marketingUnitCost).toBe(0)
    expect(result.get('p2')?.totalUnitCost).toBeCloseTo(10_000, 10)
    expect(result.get('p2')?.runCount).toBe(1)
  })

  test('여러 차수의 마케팅비를 누적 입고수량으로 가중 평균한다', () => {
    const result = calculateProductUnitCosts([
      run({
        id: 'run-1',
        items: [{ productId: 'p1', quantity: 1_000, stockedInQty: 1_000 }],
        costs: [
          {
            amount: 3_000_000,
            vatIncluded: false,
            category: 'MARKETING',
            targetProductId: 'p1',
          },
        ],
      }),
      run({
        id: 'run-2',
        items: [{ productId: 'p1', quantity: 1_000, stockedInQty: 1_000 }],
      }),
    ])

    expect(result.get('p1')).toEqual({
      productionUnitCost: 0,
      marketingUnitCost: 1_500,
      totalUnitCost: 1_500,
      runCount: 2,
    })
  })

  test('stockedInQty 0을 planned quantity로 대체하지 않는다', () => {
    const result = calculateProductUnitCosts([
      run({
        items: [{ productId: 'p1', quantity: 100, stockedInQty: 0 }],
        costs: [
          {
            amount: 100_000,
            vatIncluded: false,
            category: 'MATERIAL',
            targetProductId: null,
          },
        ],
      }),
    ])

    expect(result.has('p1')).toBe(false)
  })

  test('costs가 없는 legacy 차수는 totalCost를 생산비로 사용한다', () => {
    const result = calculateProductUnitCosts([
      run({
        totalCost: 500_000,
        items: [{ productId: 'p1', quantity: 100, stockedInQty: null }],
      }),
    ])

    expect(result.get('p1')).toEqual({
      productionUnitCost: 5_000,
      marketingUnitCost: 0,
      totalUnitCost: 5_000,
      runCount: 1,
    })
  })

  test('마케팅 비용만 있는 차수는 totalCost를 생산비로 fallback하지 않는다', () => {
    const result = calculateProductUnitCosts([
      run({
        totalCost: 500_000,
        items: [{ productId: 'p1', quantity: 10, stockedInQty: 10 }],
        costs: [
          {
            amount: 1_000,
            vatIncluded: false,
            category: 'MARKETING',
            targetProductId: 'p1',
          },
        ],
      }),
    ])

    expect(result.get('p1')).toEqual({
      productionUnitCost: 0,
      marketingUnitCost: 100,
      totalUnitCost: 100,
      runCount: 1,
    })
  })

  test('동일 상품의 여러 option item을 합산한다', () => {
    const result = calculateProductUnitCosts([
      run({
        items: [
          { productId: 'p1', quantity: 20, stockedInQty: 10 },
          { productId: 'p1', quantity: 40, stockedInQty: 30 },
        ],
        costs: [
          {
            amount: 80_000,
            vatIncluded: false,
            category: 'LABOR',
            targetProductId: null,
          },
        ],
      }),
    ])

    expect(result.get('p1')?.productionUnitCost).toBe(2_000)
    expect(result.get('p1')?.runCount).toBe(1)
  })

  test('VAT 포함 여부가 섞인 비용을 마지막까지 반올림 없이 계산한다', () => {
    const result = calculateProductUnitCosts([
      run({
        items: [
          { productId: 'p1', quantity: 2, stockedInQty: 2 },
          { productId: 'p2', quantity: 1, stockedInQty: 1 },
        ],
        costs: [
          {
            amount: 100,
            vatIncluded: true,
            category: 'MATERIAL',
            targetProductId: null,
          },
          {
            amount: 1,
            vatIncluded: false,
            category: 'OTHER',
            targetProductId: null,
          },
        ],
      }),
    ])

    expect(result.get('p1')?.productionUnitCost).toBeCloseTo((100 / 1.1 + 1) / 3, 12)
    expect(result.get('p2')?.productionUnitCost).toBeCloseTo((100 / 1.1 + 1) / 3, 12)
  })

  test('마케팅비를 대상이 아닌 상품에 배분하지 않는다', () => {
    const result = calculateProductUnitCosts([
      run({
        items: [
          { productId: 'p1', quantity: 1, stockedInQty: 1 },
          { productId: 'p2', quantity: 1, stockedInQty: 1 },
        ],
        costs: [
          {
            amount: 700,
            vatIncluded: false,
            category: 'MARKETING',
            targetProductId: 'p1',
          },
        ],
      }),
    ])

    expect(result.get('p1')?.marketingUnitCost).toBe(700)
    expect(result.get('p2')?.marketingUnitCost).toBe(0)
  })

  test('입고수량이 0인 대상 상품에는 마케팅비를 배분하지 않는다', () => {
    const result = calculateProductUnitCosts([
      run({
        items: [
          { productId: 'p1', quantity: 10, stockedInQty: 0 },
          { productId: 'p2', quantity: 10, stockedInQty: 10 },
        ],
        costs: [
          {
            amount: 1_000,
            vatIncluded: false,
            category: 'MARKETING',
            targetProductId: 'p1',
          },
        ],
      }),
    ])

    expect(result.has('p1')).toBe(false)
    expect(result.get('p2')?.marketingUnitCost).toBe(0)
  })

  test('음수 수량을 0으로 보고 전체 수량이 0인 차수를 무시한다', () => {
    const result = calculateProductUnitCosts([
      run({
        id: 'ignored',
        items: [{ productId: 'p1', quantity: -10, stockedInQty: null }],
        costs: [
          {
            amount: 100,
            vatIncluded: false,
            category: 'MATERIAL',
            targetProductId: null,
          },
        ],
      }),
      run({
        id: 'counted',
        items: [
          { productId: 'p1', quantity: 5, stockedInQty: 5 },
          { productId: 'p2', quantity: 5, stockedInQty: -2 },
        ],
      }),
    ])

    expect(result.get('p1')?.runCount).toBe(1)
    expect(result.has('p2')).toBe(false)
  })
})
