/** @jest-environment node */

// eslint-disable-next-line no-var
var mockPrisma: { productionRun: { findMany: jest.Mock } }

function ensureMocks() {
  if (!mockPrisma) mockPrisma = { productionRun: { findMany: jest.fn() } }
  return mockPrisma
}

jest.mock('@/lib/prisma', () => ({
  get prisma() {
    return ensureMocks()
  },
}))

import { loadProductionUnitCosts } from '@/lib/sh/production-cost'

describe('loadProductionUnitCosts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('실제 입고수량과 대상 상품 마케팅비를 반영한 합산 단가를 반환한다', async () => {
    ensureMocks().productionRun.findMany.mockResolvedValue([
      {
        id: 'r1',
        totalCost: 1_980_000,
        items: [
          { quantity: 120, stockedInQty: 100, option: { productId: 'p1' } },
          { quantity: 50, stockedInQty: 50, option: { productId: 'p2' } },
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
      },
    ])

    const costs = await loadProductionUnitCosts('space-1', ['p1'])

    expect(costs.get('p1')).toBeCloseTo(13_000, 10)
  })
})
