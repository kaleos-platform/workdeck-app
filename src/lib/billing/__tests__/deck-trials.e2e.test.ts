/** @jest-environment node */
// 별도 로컬 DB + 모킹 PG로 업무별 체험·면제 청구를 검증한다.
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })

const mockCharge = jest.fn().mockResolvedValue({ ok: true, paymentKey: 'local-test' })
jest.mock('server-only', () => ({}))
jest.mock('@/lib/billing/deck-release', () => ({ findClosedDecks: async () => [] }))
jest.mock('@/lib/billing/providers/toss', () => ({
  getBillingProvider: () => ({ id: 'toss', charge: mockCharge, fetchPaymentByOrderId: jest.fn() }),
}))
import { prisma } from '@/lib/prisma'
import { updateSubscriptionAccess } from '../subscription-admin'
import { encryptField } from '@/lib/crypto/field-crypto'
import { ensureTrialStarted, resolveEntitlement } from '../entitlement'
import { addDeck, runDueCharges, startSubscription } from '../subscription-service'

const RUN = /@(127\.0\.0\.1|localhost):55471\/deck_trials/.test(process.env.DATABASE_URL ?? '')
const d = RUN ? describe : describe.skip
const SPACE = 'test-deck-access-isolated'
const NOW = new Date()

d('업무별 체험·면제 실 DB', () => {
  beforeAll(async () => {
    process.env.ENCRYPTION_KEY_V1 = '0123456789abcdef'.repeat(4)
    delete process.env.BILLING_CHECKOUT_PAUSED
    for (const id of ['finance', 'recruiting']) {
      await prisma.billingDeckProduct.upsert({
        where: { id },
        create: { id, name: id, monthlyPrice: 20000, pricingMode: 'SUBSCRIPTION' },
        update: { pricingMode: 'SUBSCRIPTION' },
      })
    }
  })
  beforeEach(async () => {
    await prisma.billingCharge.deleteMany({ where: { spaceId: SPACE } })
    await prisma.space.deleteMany({ where: { id: SPACE } })
    await prisma.space.create({ data: { id: SPACE, name: '체험 검증 전용' } })
    mockCharge.mockClear()
  })
  afterAll(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { targetId: { startsWith: `${SPACE}:` } } })
    await prisma.billingCharge.deleteMany({ where: { spaceId: SPACE } })
    await prisma.space.deleteMany({ where: { id: SPACE } })
    await prisma.$disconnect()
  })
  async function paid() {
    const encrypted = encryptField('billing-key', 'local-mock-card')
    await prisma.billingMethod.create({
      data: {
        spaceId: SPACE,
        provider: 'toss',
        billingKey: encrypted.encrypted,
        billingKeyIv: encrypted.iv,
      },
    })
    return prisma.spaceSubscription.create({
      data: {
        spaceId: SPACE,
        status: 'ACTIVE',
        customerKey: 'local-customer',
        currentPeriodEnd: new Date(NOW.getTime() - 1000),
        items: {
          create: [
            { deckAppId: 'finance', priceSnapshot: 20000 },
            { deckAppId: 'recruiting', priceSnapshot: 10000 },
          ],
        },
      },
    })
  }
  test('동시 체험 시작과 재추가가 종료일을 바꾸지 않는다', async () => {
    await Promise.all([ensureTrialStarted(SPACE, 'finance'), ensureTrialStarted(SPACE, 'finance')])
    const first = await prisma.spaceDeckAccess.findUniqueOrThrow({
      where: { spaceId_deckAppId: { spaceId: SPACE, deckAppId: 'finance' } },
    })
    expect(first.trialEndsAt!.getTime() - Date.now()).toBeGreaterThan(6.9 * 86400000)
    await ensureTrialStarted(SPACE, 'finance')
    expect(await prisma.spaceDeckAccess.count({ where: { spaceId: SPACE } })).toBe(1)
    expect(
      (await prisma.spaceDeckAccess.findUniqueOrThrow({ where: { id: first.id } })).trialEndsAt
    ).toEqual(first.trialEndsAt)
  })
  test('재무 체험 만료와 모집 체험은 독립이다', async () => {
    await ensureTrialStarted(SPACE, 'finance')
    await prisma.spaceDeckAccess.updateMany({
      where: { spaceId: SPACE },
      data: { trialEndsAt: new Date('2020-01-01') },
    })
    await ensureTrialStarted(SPACE, 'recruiting')
    const result = await resolveEntitlement(SPACE)
    expect(result.decks.finance.reason).toBe('LOCKED')
    expect(result.decks.recruiting.reason).toBe('TRIAL')
    expect(result.decks.recruiting.trialEndsAt).toBeTruthy()
  })
  test('전체 면제·업무 면제 중에는 새 체험을 소비하지 않는다', async () => {
    await prisma.spaceSubscription.create({ data: { spaceId: SPACE, exemptFlag: true } })
    await ensureTrialStarted(SPACE, 'finance')
    expect(await prisma.spaceDeckAccess.count({ where: { spaceId: SPACE } })).toBe(0)
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE },
      data: { exemptFlag: false },
    })
    await prisma.spaceDeckAccess.create({
      data: { spaceId: SPACE, deckAppId: 'finance', exemptFlag: true },
    })
    await ensureTrialStarted(SPACE, 'finance')
    expect(
      (await prisma.spaceDeckAccess.findFirstOrThrow({ where: { spaceId: SPACE } })).trialEndsAt
    ).toBeNull()
  })
  test('면제 업무가 섞인 정기청구는 유료 업무만 청구한다', async () => {
    await paid()
    await prisma.spaceDeckAccess.create({
      data: { spaceId: SPACE, deckAppId: 'finance', exemptFlag: true },
    })
    await runDueCharges(NOW)
    expect(mockCharge).toHaveBeenCalledTimes(1)
    expect(mockCharge.mock.calls[0][0].amount).toBe(11000)
    const charge = await prisma.billingCharge.findFirstOrThrow({ where: { spaceId: SPACE } })
    expect(charge.breakdown).toEqual([{ deckAppId: 'recruiting', type: 'DECK', price: 10000 }])
  })
  test('모든 업무가 면제이면 PG 호출·청구 생성 없이 주기만 이동한다', async () => {
    const sub = await paid()
    await prisma.spaceDeckAccess.createMany({
      data: ['finance', 'recruiting'].map((deckAppId) => ({
        spaceId: SPACE,
        deckAppId,
        exemptFlag: true,
      })),
    })
    await runDueCharges(NOW)
    expect(mockCharge).not.toHaveBeenCalled()
    expect(await prisma.billingCharge.count({ where: { spaceId: SPACE } })).toBe(0)
    expect(
      (
        await prisma.spaceSubscription.findUniqueOrThrow({ where: { id: sub.id } })
      ).currentPeriodEnd!.getTime()
    ).toBeGreaterThan(NOW.getTime())
  })
  test('면제 업무의 신규 구독은 PG 호출 전에 거절한다', async () => {
    await paid()
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE },
      data: { status: 'TRIALING' },
    })
    await prisma.spaceDeckAccess.create({
      data: { spaceId: SPACE, deckAppId: 'finance', exemptFlag: true },
    })
    await expect(startSubscription(SPACE, ['finance'])).rejects.toThrow('면제')
    expect(mockCharge).not.toHaveBeenCalled()
  })
  test('면제 업무의 일할 추가는 PG 호출 전에 거절한다', async () => {
    const sub = await paid()
    await prisma.subscriptionItem.updateMany({
      where: { subscriptionId: sub.id, deckAppId: 'finance' },
      data: { status: 'ENDED' },
    })
    await prisma.spaceDeckAccess.create({
      data: { spaceId: SPACE, deckAppId: 'finance', exemptFlag: true },
    })
    await expect(addDeck(SPACE, 'finance')).rejects.toThrow('면제')
    expect(mockCharge).not.toHaveBeenCalled()
  })
  test('청구 준비 중 면제가 설정되면 최종 PG 호출 전에 재확인한다', async () => {
    await paid()
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE },
      data: { status: 'TRIALING' },
    })
    const findMethod = prisma.billingMethod.findFirst.bind(prisma.billingMethod)
    const spy = jest.spyOn(prisma.billingMethod, 'findFirst').mockImplementationOnce((async (
      args: Parameters<typeof prisma.billingMethod.findFirst>[0]
    ) => {
      await prisma.spaceDeckAccess.create({
        data: { spaceId: SPACE, deckAppId: 'finance', exemptFlag: true },
      })
      return findMethod(args)
    }) as unknown as typeof prisma.billingMethod.findFirst)
    try {
      await expect(startSubscription(SPACE, ['finance'])).rejects.toThrow('면제')
      expect(mockCharge).not.toHaveBeenCalled()
      expect(await prisma.billingCharge.count({ where: { spaceId: SPACE } })).toBe(0)
    } finally {
      spy.mockRestore()
    }
  })

  test('연장 변경과 감사로그는 함께 커밋되며 결제 상태는 바뀌지 않는다', async () => {
    await ensureTrialStarted(SPACE, 'finance')
    const result = await updateSubscriptionAccess('local-test-operator', SPACE, 'finance', {
      trialEndsOn: '2030-12-31',
      note: '검증 연장',
    })
    expect(result.trialEndsAt).toBe('2030-12-31T15:00:00.000Z')
    expect(
      await prisma.adminAuditLog.count({
        where: { targetId: `${SPACE}:finance`, action: 'billing.deck.trial.extend' },
      })
    ).toBe(1)
    expect(await prisma.spaceSubscription.findUnique({ where: { spaceId: SPACE } })).toBeNull()
    expect(mockCharge).not.toHaveBeenCalled()
  })
  test('감사로그 저장 실패 시 실제 정책 변경도 롤백된다', async () => {
    await ensureTrialStarted(SPACE, 'finance')
    const prior = await prisma.spaceDeckAccess.findFirstOrThrow({ where: { spaceId: SPACE } })
    // DB 제약 실패를 같은 transaction 안에서 발생시켜 실제 rollback을 검증한다.
    await expect(
      updateSubscriptionAccess(null as unknown as string, SPACE, 'finance', {
        trialEndsOn: '2030-12-31',
        note: '실패 검증',
      })
    ).rejects.toThrow()
    expect(
      (await prisma.spaceDeckAccess.findFirstOrThrow({ where: { spaceId: SPACE } })).trialEndsAt
    ).toEqual(prior.trialEndsAt)
  })
  test('업무 면제는 해당 라인만 종료하고 보장가·다른 업무 구독은 유지한다', async () => {
    const sub = await paid()
    await prisma.subscriptionItem.updateMany({
      where: { subscriptionId: sub.id, deckAppId: 'finance' },
      data: { lockedPrice: 12345 },
    })
    await updateSubscriptionAccess('local-test-operator', SPACE, 'finance', {
      exempt: true,
      note: '재무만 면제',
    })
    const items = await prisma.subscriptionItem.findMany({ where: { subscriptionId: sub.id } })
    expect(items.find((i) => i.deckAppId === 'finance')).toMatchObject({
      status: 'ENDED',
      lockedPrice: 12345,
    })
    expect(items.find((i) => i.deckAppId === 'recruiting')!.status).toBe('ACTIVE')
    expect(
      (await prisma.spaceSubscription.findUniqueOrThrow({ where: { id: sub.id } })).status
    ).toBe('ACTIVE')
    await updateSubscriptionAccess('local-test-operator', SPACE, 'finance', {
      exempt: false,
      note: '면제 해제',
    })
    expect(
      (
        await prisma.subscriptionItem.findFirstOrThrow({
          where: { subscriptionId: sub.id, deckAppId: 'finance' },
        })
      ).status
    ).toBe('ENDED')
    expect(mockCharge).not.toHaveBeenCalled()
  })
  test('마지막 업무 면제 뒤 해제해도 자동 구독·소급 청구하지 않는다', async () => {
    const sub = await paid()
    await updateSubscriptionAccess('local-test-operator', SPACE, 'finance', {
      exempt: true,
      note: '면제',
    })
    await updateSubscriptionAccess('local-test-operator', SPACE, 'recruiting', {
      exempt: true,
      note: '면제',
    })
    expect(
      (await prisma.spaceSubscription.findUniqueOrThrow({ where: { id: sub.id } })).status
    ).toBe('CANCELED')
    await updateSubscriptionAccess('local-test-operator', SPACE, 'recruiting', {
      exempt: false,
      note: '해제',
    })
    await runDueCharges(NOW)
    expect(mockCharge).not.toHaveBeenCalled()
  })
  test('PENDING 청구가 있으면 업무 면제를 거절하고 원래 정책을 유지한다', async () => {
    await paid()
    await prisma.billingCharge.create({
      data: {
        spaceId: SPACE,
        orderId: 'test-pending-policy',
        amount: 110,
        supplyAmount: 100,
        vatAmount: 10,
        status: 'PENDING',
        provider: 'toss',
        periodStart: NOW,
        periodEnd: NOW,
        breakdown: [],
      },
    })
    await expect(
      updateSubscriptionAccess('local-test-operator', SPACE, 'finance', {
        exempt: true,
        note: '면제',
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(await prisma.spaceDeckAccess.count({ where: { spaceId: SPACE } })).toBe(0)
  })
})
