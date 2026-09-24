// Jest mock factory가 import 전에 평가되므로 var로 hoist 가능한 mock 저장소를 둔다.
// eslint-disable-next-line no-var
var mockPrisma: {
  productionRun: { findFirst: jest.Mock }
  invProductOption: { findMany: jest.Mock }
  brand: { findFirst: jest.Mock }
  $transaction: jest.Mock
}
// eslint-disable-next-line no-var
var mockTx: {
  productionRun: { update: jest.Mock }
  productionRunItem: {
    findMany: jest.Mock
    deleteMany: jest.Mock
    createMany: jest.Mock
  }
  productionRunCost: { deleteMany: jest.Mock; createMany: jest.Mock }
}

function ensureMocks() {
  if (!mockPrisma) {
    mockTx = {
      productionRun: { update: jest.fn() },
      productionRunItem: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      productionRunCost: { deleteMany: jest.fn(), createMany: jest.fn() },
    }
    mockPrisma = {
      productionRun: { findFirst: jest.fn() },
      invProductOption: { findMany: jest.fn() },
      brand: { findFirst: jest.fn() },
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

import { GET, PATCH } from '../route'

const params = { params: Promise.resolve({ runId: 'run-1' }) }
const existing = {
  id: 'run-1',
  costMode: 'TOTAL',
  status: 'PLANNED',
  items: [{ option: { product: { id: 'product-1' } } }],
  costs: [{ category: 'MARKETING', targetProductId: 'product-1' }],
}

function request(body: unknown): Parameters<typeof PATCH>[0] {
  return { json: async () => body } as Parameters<typeof PATCH>[0]
}

async function callPatch(body: unknown) {
  const response = await PATCH(request(body), params)
  if (!response) throw new Error('라우트가 응답을 반환하지 않았습니다')
  return response
}

async function callGet() {
  const response = await GET({} as Parameters<typeof GET>[0], params)
  if (!response) throw new Error('라우트가 응답을 반환하지 않았습니다')
  return response
}

function marketing(targetProductId: string) {
  return {
    itemName: '광고비',
    quantity: 1,
    unitPrice: 10_000,
    category: 'MARKETING' as const,
    targetProductId,
  }
}

describe('PATCH /api/sh/production-runs/[runId]', () => {
  beforeEach(() => {
    const { prisma, tx } = ensureMocks()
    jest.clearAllMocks()
    prisma.productionRun.findFirst.mockResolvedValue(existing)
    prisma.$transaction.mockImplementation(async (callback) => callback(tx))
    tx.productionRun.update.mockResolvedValue({ id: 'run-1' })
    tx.productionRunItem.findMany.mockResolvedValue([])
    tx.productionRunItem.deleteMany.mockResolvedValue({ count: 1 })
    tx.productionRunItem.createMany.mockResolvedValue({ count: 1 })
    tx.productionRunCost.deleteMany.mockResolvedValue({ count: 1 })
    tx.productionRunCost.createMany.mockResolvedValue({ count: 1 })
  })

  test('items와 costs가 없으면 불일치한 기존 조합을 transaction 전에 거부한다', async () => {
    mockPrisma.productionRun.findFirst.mockResolvedValue({
      ...existing,
      costs: [{ category: 'MARKETING', targetProductId: 'product-2' }],
    })

    const response = await callPatch({ memo: '메모만 수정' })

    expect(response.status).toBe(400)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  test('items만 변경해 기존 비용의 대상 상품을 제거하면 transaction 전에 거부한다', async () => {
    mockPrisma.invProductOption.findMany.mockResolvedValue([
      { id: 'option-2', product: { id: 'product-2' } },
    ])

    const response = await callPatch({ items: [{ optionId: 'option-2', quantity: 10 }] })

    expect(response.status).toBe(400)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  test('costs만 변경하면 기존 items의 상품 집합으로 검증한다', async () => {
    const response = await callPatch({ costs: [marketing('product-2')] })

    expect(response.status).toBe(400)
    expect(mockPrisma.invProductOption.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  test('items와 costs를 함께 변경하면 새 조합을 허용하고 대상을 저장한다', async () => {
    mockPrisma.invProductOption.findMany.mockResolvedValue([
      { id: 'option-2', product: { id: 'product-2' } },
    ])

    const response = await callPatch({
      items: [{ optionId: 'option-2', quantity: 10 }],
      costs: [marketing('product-2')],
    })

    expect(response.status).toBe(200)
    expect(mockPrisma.invProductOption.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['option-2'] }, product: { spaceId: 'space-1' } },
      select: { id: true, product: { select: { id: true } } },
    })
    expect(mockTx.productionRunCost.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ category: 'MARKETING', targetProductId: 'product-2' })],
    })
  })
})

describe('GET /api/sh/production-runs/[runId]', () => {
  test('비용의 category와 targetProductId를 반환한다', async () => {
    ensureMocks().prisma.productionRun.findFirst.mockResolvedValue({
      id: 'run-1',
      runNo: 'RUN-1',
      status: 'PLANNED',
      brand: null,
      dueAt: null,
      completedAt: null,
      orderedConfirmedAt: null,
      stockedInAt: null,
      stockInLocationId: null,
      totalCost: 10_000,
      costMode: 'TOTAL',
      memo: null,
      items: [],
      costs: [
        {
          id: 'cost-1',
          itemName: '광고비',
          description: null,
          spec: null,
          quantity: 1,
          unitPrice: 10_000,
          amount: 10_000,
          note: null,
          sortOrder: 0,
          category: 'MARKETING',
          targetProductId: 'product-1',
          vatIncluded: true,
        },
      ],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    })

    const response = await callGet()
    const body = await response.json()

    expect(body.run.costs[0]).toEqual(
      expect.objectContaining({ category: 'MARKETING', targetProductId: 'product-1' })
    )
  })
})
