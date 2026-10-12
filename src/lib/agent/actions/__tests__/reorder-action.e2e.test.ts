/**
 * seller-hub.reorder.plan.create execute 실검증 e2e — 실 dev DB.
 * Phase 4 인계 항목: 발주 계획 액션이 최소 구현으로 실제 ReorderPlan을 생성하는지 확인.
 * 수요 데이터 없는(활성 채널 0) 최소 상품으로 크래시 없이 계획 생성됨을 검증한다.
 */
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '../create'
import { approveAndExecute } from '../execute'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000e1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000e2'

d('seller-hub.reorder.plan.create execute', () => {
  let productId: string

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-reorder@throwaway.test', name: 'E2E Reorder' },
    })
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E Reorder Throwaway', type: 'PERSONAL' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_ID, userId: USER_ID } },
      update: {},
      create: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' },
    })
    // 최소 상품: 그룹 → 상품(ACTIVE) → 옵션 1개.
    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: 'E2E 그룹' },
    })
    const product = await prisma.invProduct.create({
      data: {
        spaceId: SPACE_ID,
        name: 'E2E 상품',
        groupId: group.id,
        status: 'ACTIVE',
        options: { create: [{ name: 'E2E 옵션', safetyStockQty: 5 }] },
      },
      select: { id: true },
    })
    productId = product.id
  })

  afterAll(async () => {
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: SPACE_ID } })
    // ReorderPlan/Item, 상품/옵션/그룹은 Space cascade로 정리된다.
    await prisma.spaceMember.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: SPACE_ID } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
    await prisma.$disconnect()
  })

  test('승인 실행 → ReorderPlan(DRAFT) + Item 생성', async () => {
    const created = await createPendingAction({
      spaceId: SPACE_ID,
      actionType: 'seller-hub.reorder.plan.create',
      params: { productId },
      summary: '발주 계획: E2E 상품',
      source: 'MCP',
      actor: { type: 'user', id: USER_ID },
    })
    const out = await approveAndExecute(created.actionId, USER_ID)
    expect(out.status).toBe('EXECUTED')

    const plans = await prisma.reorderPlan.findMany({
      where: { spaceId: SPACE_ID, productId },
      include: { items: true },
    })
    expect(plans).toHaveLength(1)
    expect(plans[0].status).toBe('DRAFT')
    expect(plans[0].items.length).toBeGreaterThanOrEqual(1)

    // 정리 (다음 실행 대비)
    await prisma.reorderPlan.deleteMany({ where: { spaceId: SPACE_ID } })
  })

  test('에이전트가 제안한 발주 계획은 승인자를 createdById로 기록한다', async () => {
    const r = await createPendingAction({
      spaceId: SPACE_ID,
      actionType: 'seller-hub.reorder.plan.create',
      params: { productId },
      summary: 'e2e 에이전트 제안',
      source: 'MCP',
      actor: { type: 'agent', id: 'ag-e2e' }, // User가 아님 — createdById(User FK)로 쓰면 깨진다
    })
    const out = await approveAndExecute(r.actionId, USER_ID)
    expect(out.status).toBe('EXECUTED')
    const planId = (out as { result: { planId: string } }).result.planId
    const plan = await prisma.reorderPlan.findUnique({
      where: { id: planId },
      select: { createdById: true },
    })
    expect(plan?.createdById).toBe(USER_ID)

    await prisma.reorderPlan.deleteMany({ where: { spaceId: SPACE_ID } })
  })
})
