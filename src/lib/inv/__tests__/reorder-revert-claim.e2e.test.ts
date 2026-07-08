/**
 * POST /sh/inventory/reorder/plan/[planId]/revert — 동시 revert 중복 DRAFT 차단 e2e.
 *
 * 두 요청이 동시에 FINALIZED 계획을 revert할 때 정확히 1건만 성공(200)하고
 * 나머지는 409로 차단되어야 한다. DB에 DRAFT revision이 1건만 생성됨을 확인.
 * 수정 없으면 DRAFT 2건 생성 → red.
 *
 * throwaway space/user를 시드. afterAll cascade로 0-state 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return { __esModule: true, ...actual, resolveDeckContext: jest.fn() }
})

import { resolveDeckContext } from '@/lib/api-helpers'
import { POST } from '../../../../app/api/sh/inventory/reorder/plan/[planId]/revert/route'

// throwaway — 다른 e2e와 충돌 없도록 고유 hex UUID 사용
const SPACE_ID = 'e2e00000-0000-4000-8000-00000000ee01'
const USER_ID = 'e2e00000-0000-4000-8000-00000000ee02'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let planId = ''
let optionId = ''

async function cleanup() {
  // 역순 삭제 — FK Restrict 충돌 방지
  await prisma.reorderPlanAccuracy.deleteMany({ where: { plan: { spaceId: SPACE_ID } } })
  await prisma.reorderPlanItem.deleteMany({ where: { plan: { spaceId: SPACE_ID } } })
  await prisma.reorderPlanSet.deleteMany({ where: { plan: { spaceId: SPACE_ID } } })
  await prisma.reorderPlan.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

function postReq() {
  return new NextRequest('http://localhost/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

d('POST revert — 동시 revert 중복 DRAFT 차단 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E RevertClaim', type: 'PERSONAL' },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-revert-claim@throwaway.test' },
    })

    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: '기본' },
    })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E Revert상품', groupId: group.id, status: 'ACTIVE' },
    })
    const option = await prisma.invProductOption.create({
      data: { productId: product.id, name: 'A' },
    })
    optionId = option.id

    // FINALIZED 계획 시드 (supersededAt=null — revert 대상)
    const plan = await prisma.reorderPlan.create({
      data: {
        spaceId: SPACE_ID,
        planNo: 'E2E-REVERT-001',
        status: 'FINALIZED',
        windowDays: 30,
        createdById: USER_ID,
        totalSuggestedQty: 10,
        totalFinalQty: 10,
        items: {
          create: [
            {
              optionId,
              productId: product.id,
              currentStock: 5,
              dailyAvgForecast: 1,
              forecastModel: 'SMA',
              leadTimeDays: 7,
              safetyStockQty: 3,
              suggestedQty: 10,
              roundedSuggestedQty: 10,
              finalQty: 10,
              roundUnit: 1,
              biasAdjustFactor: 1,
              inputsSnapshot: {},
            },
          ],
        },
      },
    })
    planId = plan.id

    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID, name: 'E2E RevertClaim' },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('동시 revert — 정확히 1건 성공(200), 1건 409, DRAFT revision 1건만 생성', async () => {
    const params = Promise.resolve({ planId })

    // 두 요청을 동시에 실행
    const [res1, res2] = await Promise.all([
      POST(postReq(), { params }),
      POST(postReq(), { params }),
    ])

    const statuses = [res1!.status, res2!.status].sort()

    // 정확히 하나 성공(200), 하나 409
    expect(statuses).toEqual([200, 409])

    // DB에 sourcePlanId=planId인 DRAFT revision이 정확히 1건 (중복 없음)
    const drafts = await prisma.reorderPlan.findMany({
      where: { sourcePlanId: planId, status: 'DRAFT' },
    })
    expect(drafts).toHaveLength(1)

    // 원본 계획은 supersededAt이 마킹됨
    const original = await prisma.reorderPlan.findUnique({ where: { id: planId } })
    expect(original?.supersededAt).not.toBeNull()
  })
})
