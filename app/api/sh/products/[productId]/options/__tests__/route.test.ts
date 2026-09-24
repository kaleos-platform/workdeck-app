/** @jest-environment node */

// eslint-disable-next-line no-var
var mockPrisma: {
  invProduct: { findFirst: jest.Mock }
  invProductOption: { findMany: jest.Mock }
  invStockLevel: { groupBy: jest.Mock }
  productionRun: { findMany: jest.Mock }
}

function ensureMocks() {
  if (!mockPrisma) {
    mockPrisma = {
      invProduct: { findFirst: jest.fn() },
      invProductOption: { findMany: jest.fn() },
      invStockLevel: { groupBy: jest.fn() },
      productionRun: { findMany: jest.fn() },
    }
  }
  return mockPrisma
}

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn().mockResolvedValue({ space: { id: 'space-1' } }),
  errorResponse: (message: string, status: number) => ({
    status,
    json: async () => ({ message }),
  }),
}))

jest.mock('@/lib/prisma', () => ({
  get prisma() {
    return ensureMocks()
  },
}))

import { GET } from '../route'

async function callGet() {
  const response = await GET({} as Parameters<typeof GET>[0], {
    params: Promise.resolve({ productId: 'p1' }),
  })
  if (!response) throw new Error('라우트가 응답을 반환하지 않았습니다')
  return response
}

describe('GET /api/sh/products/[productId]/options', () => {
  beforeEach(() => {
    const prisma = ensureMocks()
    jest.clearAllMocks()
    prisma.invProductOption.findMany.mockResolvedValue([
      {
        id: 'o1',
        name: 'A',
        costPrice: 9_900,
        costVatIncluded: true,
      },
    ])
    prisma.invStockLevel.groupBy.mockResolvedValue([{ optionId: 'o1', _sum: { quantity: 7 } }])
    prisma.productionRun.findMany.mockResolvedValue([])
  })

  test('차수의 모든 item으로 배분한 생산·마케팅 단가를 옵션에 반환한다', async () => {
    const prisma = ensureMocks()
    prisma.invProduct.findFirst.mockResolvedValue({ id: 'p1', useProductionCost: true })
    prisma.productionRun.findMany.mockResolvedValue([
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

    const response = await callGet()
    const body = await response.json()

    expect(prisma.productionRun.findMany).toHaveBeenCalledWith({
      where: {
        spaceId: 'space-1',
        status: 'STOCKED_IN',
        items: { some: { option: { productId: 'p1' } } },
      },
      select: {
        id: true,
        totalCost: true,
        items: {
          select: {
            quantity: true,
            stockedInQty: true,
            option: { select: { productId: true } },
          },
        },
        costs: {
          select: {
            amount: true,
            vatIncluded: true,
            category: true,
            targetProductId: true,
          },
        },
      },
    })
    expect(body.productionCost.productionUnitCost).toBeCloseTo(10_000, 10)
    expect(body.productionCost.marketingUnitCost).toBeCloseTo(3_000, 10)
    expect(body.productionCost.totalUnitCost).toBeCloseTo(13_000, 10)
    expect(body.productionCost.runCount).toBe(1)
    expect(body.options[0]).toEqual(
      expect.objectContaining({
        totalStock: 7,
        effectiveCostPrice: body.productionCost.totalUnitCost,
        productionUnitCost: body.productionCost.productionUnitCost,
        marketingUnitCost: body.productionCost.marketingUnitCost,
      })
    )
  })

  test('생산원가 연동이 꺼지면 수동 원가를 VAT 제외 생산단가로 사용한다', async () => {
    const prisma = ensureMocks()
    prisma.invProduct.findFirst.mockResolvedValue({ id: 'p1', useProductionCost: false })

    const response = await callGet()
    const body = await response.json()

    expect(body.options[0]).toEqual(
      expect.objectContaining({
        effectiveCostPrice: 9_000,
        productionUnitCost: 9_000,
        marketingUnitCost: 0,
      })
    )
  })

  test('연동이 켜져 있어도 생산 차수 결과가 없으면 수동 원가로 fallback한다', async () => {
    const prisma = ensureMocks()
    prisma.invProduct.findFirst.mockResolvedValue({ id: 'p1', useProductionCost: true })

    const response = await callGet()
    const body = await response.json()

    expect(body.productionCost).toBeNull()
    expect(body.options[0]).toEqual(
      expect.objectContaining({
        effectiveCostPrice: 9_000,
        productionUnitCost: 9_000,
        marketingUnitCost: 0,
      })
    )
  })
})
