/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import { getSubscriptionAccessOverview, updateSubscriptionAccess } from '../subscription-admin'
import {
  adminSubscriptionPatchSchema,
  trialEndOfKstDay,
} from '@/lib/validations/admin-subscriptions'

jest.mock('server-only', () => ({}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    space: { findMany: jest.fn() },
    billingDeckProduct: { findMany: jest.fn() },
  },
}))
jest.mock('../entitlement', () => ({ isCheckoutPausedFor: () => false }))

const now = new Date('2026-11-14T12:00:00Z')
const oldTrial = new Date('2026-11-10T15:00:00Z')
function database() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    space: { findUnique: jest.fn().mockResolvedValue({ id: 's' }) },
    billingDeckProduct: {
      findUnique: jest.fn().mockResolvedValue({ id: 'inv', pricingMode: 'SUBSCRIPTION' }),
    },
    deckInstance: { findUnique: jest.fn().mockResolvedValue({ id: 'instance' }) },
    spaceSubscription: {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    billingCharge: { findFirst: jest.fn().mockResolvedValue(null) },
    spaceDeckAccess: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'p',
        spaceId: 's',
        deckAppId: 'inv',
        trialEndsAt: oldTrial,
        exemptFlag: false,
        exemptNote: null,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(),
    },
    subscriptionItem: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
  }
}
let tx: ReturnType<typeof database>
beforeEach(() => {
  jest.clearAllMocks()
  tx = database()
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn(tx))
})

test('KST 선택일 다음 자정이 배타적 종료이며 불가능한 날짜는 거절한다', () => {
  expect(trialEndOfKstDay('2026-11-30').toISOString()).toBe('2026-11-30T15:00:00.000Z')
  expect(
    adminSubscriptionPatchSchema.safeParse({ trialEndsOn: '2026-02-30', note: '이유' }).success
  ).toBe(false)
  expect(
    adminSubscriptionPatchSchema.safeParse({
      trialEndsOn: '2026-11-30',
      exempt: true,
      note: '이유',
    }).success
  ).toBe(false)
  expect(adminSubscriptionPatchSchema.safeParse({ exempt: true, note: '  ' }).success).toBe(false)
})

test('만료된 체험도 미래로 연장하고 결제일은 변경하지 않으며 감사로그를 같은 transaction에 기록한다', async () => {
  await updateSubscriptionAccess('op', 's', 'inv', { trialEndsOn: '2026-11-30', note: '연장' }, now)
  expect(tx.spaceDeckAccess.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        spaceId: 's',
        deckAppId: 'inv',
        trialEndsAt: oldTrial,
        exemptFlag: false,
      }),
      data: { trialEndsAt: new Date('2026-11-30T15:00:00Z') },
    })
  )
  expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: 'op',
        meta: expect.objectContaining({
          deckAppId: 'inv',
          note: '연장',
          before: expect.objectContaining({ trialEndsAt: oldTrial.toISOString() }),
        }),
      }),
    })
  )
})

test.each(['2026-11-10', '2026-11-01'])(
  '과거 또는 기존 날짜 이하의 연장은 거절한다: %s',
  async (trialEndsOn) => {
    await expect(
      updateSubscriptionAccess('op', 's', 'inv', { trialEndsOn, note: '연장' }, now)
    ).rejects.toMatchObject({ status: 400 })
    expect(tx.spaceDeckAccess.updateMany).not.toHaveBeenCalled()
  }
)

test('유효한 유료 아이템이 있는 업무 체험은 연장하지 않는다', async () => {
  tx.spaceSubscription.findUnique.mockResolvedValue({
    id: 'sub',
    status: 'ACTIVE',
    items: [{ deckAppId: 'inv', type: 'DECK', status: 'CANCEL_AT_PERIOD_END' }],
  } as never)
  await expect(
    updateSubscriptionAccess('op', 's', 'inv', { trialEndsOn: '2026-11-30', note: '연장' }, now)
  ).rejects.toMatchObject({ status: 409 })
})

test('면제는 대상 업무 유료 아이템만 종료하며 보장가는 건드리지 않는다', async () => {
  tx.spaceSubscription.findUnique.mockResolvedValue({
    id: 'sub',
    status: 'ACTIVE',
    items: [],
  } as never)
  await updateSubscriptionAccess('op', 's', 'inv', { exempt: true, note: '지원' }, now)
  expect(tx.subscriptionItem.updateMany).toHaveBeenCalledWith({
    where: {
      subscriptionId: 'sub',
      type: 'DECK',
      deckAppId: 'inv',
      status: { in: ['ACTIVE', 'CANCEL_AT_PERIOD_END'] },
    },
    data: { status: 'ENDED', endedAt: now },
  })
})

test('낙관적 갱신 충돌은 감사로그 없이 409로 실패한다', async () => {
  tx.spaceDeckAccess.updateMany.mockResolvedValue({ count: 0 })
  await expect(
    updateSubscriptionAccess('op', 's', 'inv', { exempt: true, note: '지원' }, now)
  ).rejects.toMatchObject({ status: 409 })
  expect(tx.adminAuditLog.create).not.toHaveBeenCalled()
})

test('감사로그 실패는 transaction 밖으로 전파되어 커밋되지 않는다', async () => {
  tx.adminAuditLog.create.mockRejectedValue(new Error('audit failed'))
  let committed = false
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
    const result = await fn(tx)
    committed = true
    return result
  })
  await expect(
    updateSubscriptionAccess('op', 's', 'inv', { exempt: false, note: '해제' }, now)
  ).rejects.toThrow('audit failed')
  expect(committed).toBe(false)
})

test('구독 없는 Space의 비활성 설치·정책·종료 아이템 이력도 알려진 상품만 집계한다', async () => {
  ;(prisma.billingDeckProduct.findMany as jest.Mock).mockResolvedValue([
    { id: 'inv', name: '재고', pricingMode: 'SUBSCRIPTION', paidActivatedAt: null, isActive: true },
  ])
  ;(prisma.space.findMany as jest.Mock).mockResolvedValue([
    {
      id: 's',
      name: '공간',
      members: [{ user: { id: 'u', email: 'a@b', name: null } }],
      deckInstances: [
        { deckAppId: 'inv', createdAt: now, isActive: false },
        { deckAppId: 'unknown', createdAt: now },
      ],
      deckAccessPolicies: [],
      subscription: null,
    },
  ])
  const result = await getSubscriptionAccessOverview(now)
  expect(result.rows).toHaveLength(1)
  expect(result.rows[0]).toMatchObject({
    spaceId: 's',
    deckAppId: 'inv',
    accessReason: 'LOCKED',
    subscriptionStatus: null,
  })
  expect(result.spaces).toEqual([{ id: 's', name: '공간', exemptFlag: false, exemptNote: null }])
})

test.each(['missing', 'free', 'unstarted'])(
  '없는 대상·무료 업무·미시작 체험을 연장하지 않는다: %s',
  async (kind) => {
    if (kind === 'missing') tx.space.findUnique.mockResolvedValue(null as never)
    if (kind === 'free')
      tx.billingDeckProduct.findUnique.mockResolvedValue({ id: 'inv', pricingMode: 'FREE_BETA' })
    if (kind === 'unstarted') tx.spaceDeckAccess.findUnique.mockResolvedValue(null as never)
    await expect(
      updateSubscriptionAccess('op', 's', 'inv', { trialEndsOn: '2026-11-30', note: '연장' }, now)
    ).rejects.toMatchObject({ status: kind === 'missing' ? 404 : 409 })
  }
)

test('설치·정책·구독 이력 모두 없는 업무는 임의로 면제할 수 없다', async () => {
  tx.deckInstance.findUnique.mockResolvedValue(null as never)
  tx.spaceDeckAccess.findUnique.mockResolvedValue(null as never)
  await expect(
    updateSubscriptionAccess('op', 's', 'inv', { exempt: true, note: '지원' }, now)
  ).rejects.toMatchObject({ status: 404 })
  expect(tx.spaceDeckAccess.create).not.toHaveBeenCalled()
})

test('면제 해제는 기존 체험·결제 아이템을 생성하지 않는다', async () => {
  await updateSubscriptionAccess('op', 's', 'inv', { exempt: false, note: '해제' }, now)
  expect(tx.spaceDeckAccess.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: { exemptFlag: false, exemptNote: '해제' } })
  )
  expect(tx.subscriptionItem.updateMany).not.toHaveBeenCalled()
})

test('최초 정책 동시 생성의 유일 제약 오류는 409로 변환한다', async () => {
  tx.spaceDeckAccess.findUnique.mockResolvedValue(null as never)
  tx.spaceDeckAccess.create.mockRejectedValue({ code: 'P2002' })
  await expect(
    updateSubscriptionAccess('op', 's', 'inv', { exempt: true, note: '지원' }, now)
  ).rejects.toMatchObject({ status: 409 })
})

test('기존 종료일과 동일한 미래 날짜도 연장으로 인정하지 않는다', async () => {
  tx.spaceDeckAccess.findUnique.mockResolvedValue({
    id: 'p',
    spaceId: 's',
    deckAppId: 'inv',
    trialEndsAt: new Date('2026-11-30T15:00:00Z'),
    exemptFlag: false,
    exemptNote: null,
  })
  await expect(
    updateSubscriptionAccess('op', 's', 'inv', { trialEndsOn: '2026-11-30', note: '연장' }, now)
  ).rejects.toMatchObject({ status: 400 })
})

test('결과 미확정 청구가 있으면 면제와 연장을 모두 거절한다', async () => {
  tx.billingCharge.findFirst.mockResolvedValue({ id: 'pending' } as never)
  for (const patch of [
    { exempt: true, note: '지원' },
    { trialEndsOn: '2026-11-30', note: '지원' },
  ]) {
    await expect(
      updateSubscriptionAccess(
        'op',
        's',
        'inv',
        patch as Parameters<typeof updateSubscriptionAccess>[3],
        now
      )
    ).rejects.toMatchObject({ status: 409 })
  }
  expect(tx.spaceDeckAccess.updateMany).not.toHaveBeenCalled()
})

test('면제로 마지막 아이템을 종료하면 구독을 취소하고 결제일 이력은 보존한다', async () => {
  tx.spaceSubscription.findUnique.mockResolvedValue({
    id: 'sub',
    status: 'PAST_DUE',
    items: [],
  } as never)
  await updateSubscriptionAccess('op', 's', 'inv', { exempt: true, note: '지원' }, now)
  expect(tx.spaceSubscription.updateMany).toHaveBeenCalledWith({
    where: { id: 'sub', status: 'PAST_DUE' },
    data: { status: 'CANCELED', retryCount: 0 },
  })
})

test('다른 활성 아이템이 남으면 부모 구독의 미납 상태를 유지한다', async () => {
  tx.spaceSubscription.findUnique.mockResolvedValue({
    id: 'sub',
    status: 'PAST_DUE',
    items: [],
  } as never)
  tx.subscriptionItem.count.mockResolvedValue(1)
  await updateSubscriptionAccess('op', 's', 'inv', { exempt: true, note: '지원' }, now)
  expect(tx.spaceSubscription.updateMany).not.toHaveBeenCalled()
})

test('정책만 있거나 종료 아이템만 있는 업무 이력을 포함하고 업무별 체험 연장 가능 여부를 판정한다', async () => {
  ;(prisma.billingDeckProduct.findMany as jest.Mock).mockResolvedValue(
    ['inv', 'del', 'fin'].map((id) => ({
      id,
      name: id,
      pricingMode: 'SUBSCRIPTION',
      paidActivatedAt: null,
      isActive: true,
    }))
  )
  ;(prisma.space.findMany as jest.Mock).mockResolvedValue([
    {
      id: 's',
      name: '공간',
      members: [],
      deckInstances: [],
      deckAccessPolicies: [
        { deckAppId: 'inv', trialEndsAt: oldTrial, exemptFlag: false, exemptNote: null },
        { deckAppId: 'del', trialEndsAt: oldTrial, exemptFlag: false, exemptNote: null },
      ],
      subscription: {
        id: 'sub',
        status: 'PAST_DUE',
        exemptFlag: false,
        exemptNote: null,
        trialEndsAt: oldTrial,
        currentPeriodEnd: now,
        items: [
          { deckAppId: 'del', status: 'ACTIVE' },
          { deckAppId: 'fin', status: 'ENDED' },
        ],
      },
    },
  ])
  const result = await getSubscriptionAccessOverview(now)
  expect(result.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ deckAppId: 'inv', accessReason: 'LOCKED', canExtendTrial: true }),
      expect.objectContaining({
        deckAppId: 'del',
        accessReason: 'SUBSCRIBED',
        canExtendTrial: false,
      }),
      expect.objectContaining({
        deckAppId: 'fin',
        accessReason: 'LOCKED',
        canExtendTrial: false,
        itemStatus: 'ENDED',
      }),
    ])
  )
})

test('정책 변경은 Space 행을 먼저 잠가 같은 공간의 청구 생성과 직렬화한다', async () => {
  await updateSubscriptionAccess('op', 's', 'inv', { exempt: true, note: '지원' }, now)
  expect(tx.$queryRaw).toHaveBeenCalledWith(
    expect.arrayContaining([expect.stringContaining('FOR UPDATE')]),
    's'
  )
  expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
    tx.space.findUnique.mock.invocationCallOrder[0]
  )
})
