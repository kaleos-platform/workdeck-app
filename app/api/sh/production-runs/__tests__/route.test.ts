// Jest mock factory가 import 전에 평가되므로 var로 hoist 가능한 mock 저장소를 둔다.
// eslint-disable-next-line no-var
var mockPrisma: {
  invProductOption: { findMany: jest.Mock }
  brand: { findFirst: jest.Mock }
  reorderPlan: { findFirst: jest.Mock }
  productListing: { findMany: jest.Mock }
  $transaction: jest.Mock
}
// eslint-disable-next-line no-var
var mockTx: {
  productionRun: { create: jest.Mock }
  productionRunItem: { createMany: jest.Mock }
  productionRunSet: { createMany: jest.Mock }
  productionRunCost: { createMany: jest.Mock }
}

function ensureMocks() {
  if (!mockPrisma) {
    mockTx = {
      productionRun: { create: jest.fn() },
      productionRunItem: { createMany: jest.fn() },
      productionRunSet: { createMany: jest.fn() },
      productionRunCost: { createMany: jest.fn() },
    }
    mockPrisma = {
      invProductOption: { findMany: jest.fn() },
      brand: { findFirst: jest.fn() },
      reorderPlan: { findFirst: jest.fn() },
      productListing: { findMany: jest.fn() },
      $transaction: jest.fn(),
    }
  }
  return { prisma: mockPrisma, tx: mockTx }
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
    return ensureMocks().prisma
  },
}))

import { POST } from '../route'

function request(body: unknown): Parameters<typeof POST>[0] {
  return { json: async () => body } as Parameters<typeof POST>[0]
}

async function callPost(body: unknown) {
  const response = await POST(request(body))
  if (!response) throw new Error('라우트가 응답을 반환하지 않았습니다')
  return response
}

function cost(category: 'MARKETING' | 'MATERIAL', targetProductId: string) {
  return {
    itemName: category === 'MARKETING' ? '광고비' : '원단비',
    quantity: 1,
    unitPrice: 10_000,
    category,
    targetProductId,
  }
}

describe('POST /api/sh/production-runs', () => {
  beforeEach(() => {
    const { prisma, tx } = ensureMocks()
    jest.clearAllMocks()
    prisma.invProductOption.findMany.mockResolvedValue([
      { id: 'option-1', product: { id: 'product-1', brandId: null } },
    ])
    prisma.$transaction.mockImplementation(async (callback) => callback(tx))
    tx.productionRun.create.mockResolvedValue({ id: 'run-1' })
    tx.productionRunItem.createMany.mockResolvedValue({ count: 1 })
    tx.productionRunCost.createMany.mockResolvedValue({ count: 2 })
  })

  test('마케팅 대상 상품을 저장하고 일반 비용 대상은 null로 정규화한다', async () => {
    const response = await callPost({
      runNo: 'RUN-1',
      items: [{ optionId: 'option-1', quantity: 10 }],
      costs: [cost('MARKETING', 'product-1'), cost('MATERIAL', 'product-other')],
    })

    expect(response.status).toBe(201)
    expect(mockPrisma.invProductOption.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['option-1'] }, product: { spaceId: 'space-1' } },
      select: { id: true, product: { select: { id: true, brandId: true } } },
    })
    expect(mockTx.productionRunCost.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          runId: 'run-1',
          category: 'MARKETING',
          targetProductId: 'product-1',
        }),
        expect.objectContaining({
          runId: 'run-1',
          category: 'MATERIAL',
          targetProductId: null,
        }),
      ]),
    })
  })

  test('대상이 선택 옵션의 상품 집합 밖이면 transaction 전에 거부한다', async () => {
    const response = await callPost({
      runNo: 'RUN-1',
      items: [{ optionId: 'option-1', quantity: 10 }],
      costs: [cost('MARKETING', 'product-other')],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      message: '마케팅 비용의 대상 상품이 생산 차수에 포함되어 있지 않습니다',
    })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})
