/**
 * 승인 큐 entitlement 가드 e2e — 실 dev DB.
 * 실행 전제: .env.local(dev DB). 없으면 describe.skip.
 *
 * 검증: 구독 만료(LOCKED) Space는 큐잉·승인 실행이 모두 막히고 액션은 PENDING으로 남는다.
 *       면제(exemptFlag=true) Space는 영향받지 않는다 — 실운영 Space가 면제로 도는 중이라 필수.
 *
 * 격리: 전용 BillingDeckProduct(SUBSCRIPTION) + 전용 Space 2개를 만들고 afterAll에서 지운다.
 *       기존 테스트가 쓰는 finance 등 실 deck 의 pricingMode 는 건드리지 않는다.
 */
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '../create'
import { approveAndExecute } from '../execute'
import { __registerActionForTest } from '../registry'
import type { ActionDefinition } from '../types'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const DECK_ID = 'e2e-billing-guard-deck'
const LOCKED_SPACE = 'e2e00000-0000-4000-8000-0000000000b1'
const EXEMPT_SPACE = 'e2e00000-0000-4000-8000-0000000000b2'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000b3'
const TEST_TYPE = 'test.entitlement.noop'

let execCount = 0
const testAction: ActionDefinition = {
  actionType: TEST_TYPE,
  deckKey: DECK_ID,
  title: 'entitlement 가드 테스트 액션',
  paramsSchema: z.object({ value: z.number() }),
  requiredRole: 'ADMIN',
  async execute(_ctx, params) {
    execCount += 1
    return { doubled: (params as { value: number }).value * 2 }
  },
}

let unregister: (() => void) | null = null

d('승인 큐 entitlement 가드', () => {
  beforeAll(async () => {
    unregister = __registerActionForTest(testAction)

    // 유료 전환된 지 60일 지난 deck — 유예(14일)도 끝나 LOCKED 판정이 나온다.
    await prisma.billingDeckProduct.upsert({
      where: { id: DECK_ID },
      update: {},
      create: {
        id: DECK_ID,
        name: 'E2E 과금 가드 테스트',
        pricingMode: 'SUBSCRIPTION',
        monthlyPrice: 10000,
        paidActivatedAt: new Date(Date.now() - 60 * 24 * 3_600_000),
        isActive: true,
      },
    })

    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-billing-guard@throwaway.test', name: 'E2E Billing Guard' },
    })

    for (const id of [LOCKED_SPACE, EXEMPT_SPACE]) {
      await prisma.space.upsert({
        where: { id },
        update: {},
        create: { id, name: `E2E Billing Guard ${id.slice(-2)}`, type: 'PERSONAL' },
      })
      await prisma.spaceMember.upsert({
        where: { spaceId_userId: { spaceId: id, userId: USER_ID } },
        update: {},
        create: { spaceId: id, userId: USER_ID, role: 'OWNER' },
      })
    }

    // LOCKED_SPACE 는 구독 자체가 없다 → 면제·구독·Trial·유예 전부 미해당 → LOCKED.
    await prisma.spaceSubscription.upsert({
      where: { spaceId: EXEMPT_SPACE },
      update: { exemptFlag: true },
      create: { spaceId: EXEMPT_SPACE, status: 'EXPIRED', exemptFlag: true },
    })
  })

  afterEach(async () => {
    execCount = 0
    await prisma.agentPendingAction.deleteMany({
      where: { spaceId: { in: [LOCKED_SPACE, EXEMPT_SPACE] } },
    })
  })

  afterAll(async () => {
    await prisma.agentPendingAction.deleteMany({
      where: { spaceId: { in: [LOCKED_SPACE, EXEMPT_SPACE] } },
    })
    await prisma.spaceSubscription.deleteMany({ where: { spaceId: EXEMPT_SPACE } })
    await prisma.spaceMember.deleteMany({
      where: { spaceId: { in: [LOCKED_SPACE, EXEMPT_SPACE] } },
    })
    await prisma.space.deleteMany({ where: { id: { in: [LOCKED_SPACE, EXEMPT_SPACE] } } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
    await prisma.billingDeckProduct.deleteMany({ where: { id: DECK_ID } })
    unregister?.()
    unregister = null
    await prisma.$disconnect()
  })

  function draft(spaceId: string) {
    return {
      spaceId,
      actionType: TEST_TYPE,
      params: { value: 21 },
      summary: '테스트',
      source: 'MCP' as const,
      requestedBy: USER_ID,
    }
  }

  test('LOCKED Space — 큐잉 자체가 막힌다', async () => {
    await expect(createPendingAction(draft(LOCKED_SPACE))).rejects.toThrow('구독이 만료')
    const rows = await prisma.agentPendingAction.count({ where: { spaceId: LOCKED_SPACE } })
    expect(rows).toBe(0)
  })

  test('LOCKED Space — 이미 큐에 있던 액션은 승인해도 BLOCKED + PENDING 유지', async () => {
    // 큐잉 가드를 우회해(구독 만료 이전에 쌓인 액션 재현) 실행 경로만 검증한다.
    const row = await prisma.agentPendingAction.create({
      data: {
        spaceId: LOCKED_SPACE,
        deckKey: DECK_ID,
        actionType: TEST_TYPE,
        payload: { value: 21 },
        summary: '만료 전에 쌓인 액션',
        source: 'MCP',
        requestedBy: USER_ID,
        expiresAt: new Date(Date.now() + 72 * 3_600_000),
      },
      select: { id: true },
    })

    const out = await approveAndExecute(row.id, USER_ID)
    expect(out.status).toBe('BLOCKED')
    expect(execCount).toBe(0)

    // 상태를 바꾸지 않아야 재구독 후 그대로 승인할 수 있다.
    const after = await prisma.agentPendingAction.findUnique({ where: { id: row.id } })
    expect(after?.status).toBe('PENDING')
    expect(after?.decidedBy).toBeNull()
  })

  test('면제 Space — 큐잉·승인 모두 정상 실행', async () => {
    const created = await createPendingAction(draft(EXEMPT_SPACE))
    const out = await approveAndExecute(created.actionId, USER_ID)
    expect(out).toMatchObject({ ok: true, status: 'EXECUTED' })
    expect(execCount).toBe(1)
    const after = await prisma.agentPendingAction.findUnique({ where: { id: created.actionId } })
    expect(after?.status).toBe('EXECUTED')
  })
})
