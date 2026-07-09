/**
 * 발주 계획 아이템 PATCH — totalFinalQty 트랜잭션 원자화 회귀 방지 e2e
 *
 * PATCH /api/sh/inventory/reorder/plan/[planId]/items/[itemId] 에서
 * update item → findMany → update plan 세 쿼리가 단일 $transaction 으로 묶인 뒤에도
 * totalFinalQty 가 정확히 재계산되는지 검증한다.
 * DATABASE_URL/DIRECT_URL 없으면 describe.skip. ([[reference_prisma7_jest_integration]])
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

// auth mock — resolveDeckContext 만 대체, 나머지 실제 export 보존
jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return { __esModule: true, ...actual, resolveDeckContext: jest.fn() }
})

import { resolveDeckContext } from '@/lib/api-helpers'
import { PATCH } from '../../../../app/api/sh/inventory/reorder/plan/[planId]/items/[itemId]/route'

// 테스트 전용 throwaway Space/User — 충돌 방지를 위해 고유 hex UUID 사용
const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000c1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000c2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let planId = ''
let item1Id = ''

async function cleanup() {
  await prisma.reorderPlanItem.deleteMany({ where: { plan: { spaceId: SPACE_ID } } })
  await prisma.reorderPlanSet.deleteMany({ where: { plan: { spaceId: SPACE_ID } } })
  await prisma.reorderPlan.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

function patchReq(planId: string, itemId: string, body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/sh/inventory/reorder/plan/${planId}/items/${itemId}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
}

d('PATCH /reorder/plan/[planId]/items/[itemId] — totalFinalQty 트랜잭션 원자화 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    // Space / User 생성
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E ReorderItemTx Throwaway', type: 'PERSONAL' },
    })
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-reorder-item-tx@throwaway.test' } })

    // InvProductGroup → InvProduct → 옵션 2개
    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: '기본' },
    })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E TX 상품', groupId: group.id, status: 'ACTIVE' },
    })
    const optA = await prisma.invProductOption.create({
      data: { productId: product.id, name: '옵션A', safetyStockQty: 0 },
    })
    const optB = await prisma.invProductOption.create({
      data: { productId: product.id, name: '옵션B', safetyStockQty: 0 },
    })

    // ReorderPlan (totalFinalQty 초기값 = 10 + 20 = 30)
    const plan = await prisma.reorderPlan.create({
      data: {
        spaceId: SPACE_ID,
        planNo: 'TX-001',
        windowDays: 30,
        createdById: USER_ID,
        totalSuggestedQty: 30,
        totalFinalQty: 30,
        productId: product.id,
      },
    })
    planId = plan.id

    // 공통 ReorderPlanItem 필수 필드
    const itemBase = {
      planId,
      productId: product.id,
      currentStock: 0,
      dailyAvgForecast: 1.0,
      forecastModel: 'SMA' as const,
      leadTimeDays: 7,
      safetyStockQty: 0,
      suggestedQty: 10,
      roundedSuggestedQty: 10,
      roundUnit: 1,
      biasAdjustFactor: 1.0,
      inputsSnapshot: {},
    }

    const i1 = await prisma.reorderPlanItem.create({
      data: { ...itemBase, optionId: optA.id, finalQty: 10 },
    })
    // 아이템2는 totalFinalQty 합산 기반(20)으로만 쓰이므로 id 보관 불필요
    await prisma.reorderPlanItem.create({
      data: { ...itemBase, optionId: optB.id, finalQty: 20 },
    })
    item1Id = i1.id
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID, name: 'E2E ReorderItemTx Throwaway' },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('아이템1 finalQty 10→50 PATCH 후 plan.totalFinalQty === 70', async () => {
    const res = (await PATCH(patchReq(planId, item1Id, { finalQty: 50 }), {
      params: Promise.resolve({ planId, itemId: item1Id }),
    }))!
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.finalQty).toBe(50) // 응답값 확인

    // DB에서 plan.totalFinalQty 재계산 단언 (50 + 20 = 70)
    const plan = await prisma.reorderPlan.findUnique({
      where: { id: planId },
      select: { totalFinalQty: true },
    })
    expect(plan?.totalFinalQty).toBe(70)
  })
})
