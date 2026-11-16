/** @jest-environment node */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { GET as getPlans } from '../plans/route'
import { GET as getPlan } from '../plan/[planId]/route'
import { GET as getProducts } from '../../../products/route'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn().mockResolvedValue({ space: { id: 's1' } }),
  errorResponse: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    reorderPlan: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    invProductOption: { findMany: jest.fn() },
    invProduct: { findMany: jest.fn(), count: jest.fn() },
    invStockLevel: { groupBy: jest.fn() },
  },
}))

const accuracy = {
  optionId: 'o1',
  wape: 0.5,
  bias: 0.5,
  actualOutbound: 10,
  forecastOutbound: 15,
  stockoutDays: 1,
  overstockDays: 2,
}
const req = new NextRequest('http://localhost/api/sh')

beforeEach(() => jest.clearAllMocks())

test('목록은 ACTIVE 정산만 조회하며 계획 아이템의 모델을 정확도에 전달한다', async () => {
  jest.mocked(prisma.reorderPlan.findMany).mockResolvedValue([])
  jest.mocked(prisma.reorderPlan.findFirst).mockResolvedValue({
    planNo: 'RP-1',
    biasAdjustApplied: null,
    items: [{ optionId: 'o1', forecastModel: 'MANUAL' }],
    accuracies: [accuracy],
  } as never)
  jest
    .mocked(prisma.invProductOption.findMany)
    .mockResolvedValue([{ id: 'o1', name: '옵션', sku: null }] as never)
  const body = await (await getPlans(req))!.json()
  expect(body.latestAccuracy.accuracies[0]).toEqual(
    expect.objectContaining({ forecastModel: 'MANUAL', actualOutbound: 10, wape: 0.5 })
  )
  expect(prisma.reorderPlan.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      select: expect.objectContaining({
        items: { select: { optionId: true, forecastModel: true } },
        accuracies: expect.objectContaining({ where: { validity: 'ACTIVE' } }),
      }),
    })
  )
})

test('상세는 실제 출고와 아이템 모델을 정확도에 전달한다', async () => {
  jest.mocked(prisma.reorderPlan.findUnique).mockResolvedValue({
    id: 'p1',
    spaceId: 's1',
    productId: 'product1',
    locationId: null,
    items: [
      {
        optionId: 'o1',
        forecastModel: 'MANUAL',
        product: { id: 'product1', name: '상품' },
        option: { id: 'o1', name: '옵션' },
      },
    ],
    accuracies: [accuracy],
    productionRuns: [],
    sets: [],
  } as never)
  const body = await (await getPlan(req, { params: Promise.resolve({ planId: 'p1' }) }))!.json()
  expect(body.accuracies[0]).toEqual(
    expect.objectContaining({ forecastModel: 'MANUAL', actualOutbound: 10 })
  )
  expect(prisma.reorderPlan.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({
      include: expect.objectContaining({
        accuracies: expect.objectContaining({
          where: { validity: 'ACTIVE' },
          select: expect.objectContaining({ actualOutbound: true }),
        }),
      }),
    })
  )
})

test('상품 목록은 기존 필드와 선택 가능한 옵션을 유지하며 제외 설정만 경량 조회한다', async () => {
  jest.mocked(prisma.invProduct.findMany).mockResolvedValue([
    {
      id: 'product1',
      name: '상품',
      reorderConfig: { excludeFromForecast: true },
      options: [{ id: 'o1', name: '옵션' }],
    },
  ] as never)
  jest.mocked(prisma.invProduct.count).mockResolvedValue(1)
  jest.mocked(prisma.invStockLevel.groupBy).mockResolvedValue([])
  const body = await (await getProducts(req))!.json()
  expect(body).toEqual({
    data: [
      {
        id: 'product1',
        name: '상품',
        reorderConfig: { excludeFromForecast: true },
        options: [{ id: 'o1', name: '옵션', totalStock: 0 }],
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  expect(prisma.invProduct.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      include: expect.objectContaining({
        reorderConfig: { select: { excludeFromForecast: true } },
      }),
    })
  )
})
