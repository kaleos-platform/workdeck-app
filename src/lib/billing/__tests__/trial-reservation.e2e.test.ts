/** @jest-environment node */
// 체험 중 구독 예약: 별도 로컬 DB + 모킹 PG 로 결제 시점·주기·취소·재시도를 검증한다.
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })

const mockCharge = jest.fn()
const mockLookup = jest.fn()
jest.mock('server-only', () => ({}))
jest.mock('@/lib/billing/deck-release', () => ({ findClosedDecks: async () => [] }))
jest.mock('@/lib/billing/providers/toss', () => ({
  getBillingProvider: () => ({
    id: 'toss',
    charge: mockCharge,
    fetchPaymentByOrderId: mockLookup,
  }),
}))
import { prisma } from '@/lib/prisma'
import { encryptField } from '@/lib/crypto/field-crypto'
import {
  addDeck,
  cancelDeck,
  runDueCharges,
  runReservedStarts,
  startSubscription,
} from '../subscription-service'
import { updateSubscriptionAccess } from '../subscription-admin'

const RUN = /@(127\.0\.0\.1|localhost):55471\/deck_trials/.test(process.env.DATABASE_URL ?? '')
const d = RUN ? describe : describe.skip
const SPACE = 'test-trial-reservation-isolated'
const DAY = 86400000
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY)

d('체험 중 구독 예약 실 DB', () => {
  beforeAll(async () => {
    process.env.ENCRYPTION_KEY_V1 = '0123456789abcdef'.repeat(4)
    for (const id of ['finance', 'recruiting']) {
      await prisma.billingDeckProduct.upsert({
        where: { id },
        create: { id, name: id, monthlyPrice: 20000, pricingMode: 'SUBSCRIPTION' },
        update: { pricingMode: 'SUBSCRIPTION', monthlyPrice: 20000, isActive: true },
      })
    }
  })
  beforeEach(async () => {
    delete process.env.BILLING_CHECKOUT_PAUSED
    await prisma.billingCharge.deleteMany({ where: { spaceId: SPACE } })
    await prisma.space.deleteMany({ where: { id: SPACE } })
    await prisma.space.create({ data: { id: SPACE, name: '체험 예약 검증 전용' } })
    mockCharge.mockReset().mockResolvedValue({ ok: true, paymentKey: 'local-pk' })
    mockLookup.mockReset().mockResolvedValue(null)
    const encrypted = encryptField('billing-key', 'local-mock-card')
    await prisma.billingMethod.create({
      data: {
        spaceId: SPACE,
        provider: 'toss',
        billingKey: encrypted.encrypted,
        billingKeyIv: encrypted.iv,
      },
    })
  })
  afterAll(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { targetId: { startsWith: `${SPACE}:` } } })
    await prisma.billingCharge.deleteMany({ where: { spaceId: SPACE } })
    await prisma.space.deleteMany({ where: { id: SPACE } })
    await prisma.$disconnect()
  })

  async function trial(deckAppId: string, endsAt: Date) {
    await prisma.spaceDeckAccess.upsert({
      where: { spaceId_deckAppId: { spaceId: SPACE, deckAppId } },
      create: { spaceId: SPACE, deckAppId, trialEndsAt: endsAt },
      update: { trialEndsAt: endsAt },
    })
  }
  async function blankSubscription() {
    return prisma.spaceSubscription.create({
      data: { spaceId: SPACE, status: 'TRIALING', customerKey: 'local-customer' },
    })
  }
  const sub = () =>
    prisma.spaceSubscription.findUniqueOrThrow({
      where: { spaceId: SPACE },
      include: { items: true },
    })
  const item = async (deckAppId: string) =>
    (await sub()).items.find((i) => i.deckAppId === deckAppId)!

  // 이미 결제된 활성 구독: finance 결제됨, 다음 결제일 +20일
  async function paidSubscription(periodEnd = at(20)) {
    return prisma.spaceSubscription.create({
      data: {
        spaceId: SPACE,
        status: 'ACTIVE',
        customerKey: 'local-customer',
        currentPeriodEnd: periodEnd,
        items: { create: [{ deckAppId: 'finance', priceSnapshot: 20000 }] },
      },
    })
  }

  test('체험 중 구독 시작은 0원이고 결제일이 체험 종료일이다', async () => {
    await blankSubscription()
    const ends = at(5)
    await trial('finance', ends)
    const result = await startSubscription(SPACE, ['finance'])
    expect(result.amount).toBe(0)
    expect(mockCharge).not.toHaveBeenCalled()
    const s = await sub()
    expect(s.status).toBe('ACTIVE')
    expect(s.currentPeriodEnd).toEqual(ends)
    expect((await item('finance')).awaitingTrialEnd).toBe(true)
  })

  test('혼합 시작은 체험 아닌 업무만 즉시 결제하고 체험 업무는 예약한다', async () => {
    await blankSubscription()
    await trial('finance', at(5))
    await startSubscription(SPACE, ['finance', 'recruiting'])
    expect(mockCharge).toHaveBeenCalledTimes(1)
    expect(mockCharge.mock.calls[0][0].amount).toBe(22000)
    expect((await item('finance')).awaitingTrialEnd).toBe(true)
    expect((await item('recruiting')).awaitingTrialEnd).toBe(false)
    expect((await sub()).currentPeriodEnd!.getTime()).toBeGreaterThan(at(27).getTime())
  })

  test('활성 구독에 체험 업무를 추가하면 0원 예약이다', async () => {
    await paidSubscription()
    await trial('recruiting', at(3))
    const result = await addDeck(SPACE, 'recruiting')
    expect(result.amount).toBe(0)
    expect(mockCharge).not.toHaveBeenCalled()
    expect((await item('recruiting')).awaitingTrialEnd).toBe(true)
  })

  test('예약 전용 구독에 더 이른 체험 업무를 추가하면 결제일이 앞당겨진다', async () => {
    await blankSubscription()
    await trial('finance', at(5))
    await startSubscription(SPACE, ['finance'])
    const early = at(2)
    await trial('recruiting', early)
    await addDeck(SPACE, 'recruiting')
    expect((await sub()).currentPeriodEnd).toEqual(early)
    expect(mockCharge).not.toHaveBeenCalled()
  })

  test('예약 전용 구독에 체험 아닌 업무를 추가하면 한 달 전액 결제로 주기를 시작한다', async () => {
    await blankSubscription()
    await trial('finance', at(5))
    await startSubscription(SPACE, ['finance'])
    await addDeck(SPACE, 'recruiting')
    expect(mockCharge).toHaveBeenCalledTimes(1)
    expect(mockCharge.mock.calls[0][0].amount).toBe(22000)
    expect((await sub()).currentPeriodEnd!.getTime()).toBeGreaterThan(at(27).getTime())
    expect((await item('finance')).awaitingTrialEnd).toBe(true)
  })

  test('체험 종료 전 예약 취소는 0원·보장가 유지·마지막이면 구독 종료', async () => {
    await blankSubscription()
    await trial('finance', at(5))
    await startSubscription(SPACE, ['finance'])
    await prisma.subscriptionItem.updateMany({
      where: { deckAppId: 'finance', subscription: { spaceId: SPACE } },
      data: { lockedPrice: 12273 },
    })
    const result = await cancelDeck(SPACE, 'finance')
    expect(result).toEqual({ effectiveAt: null, reservationCanceled: true })
    const s = await sub()
    expect(s.status).toBe('CANCELED')
    expect(s.currentPeriodEnd).toBeNull()
    const f = await item('finance')
    expect(f.status).toBe('ENDED')
    expect(f.lockedPrice).toBe(12273)
    expect(mockCharge).not.toHaveBeenCalled()
  })

  test('예약 하나만 취소하면 남은 예약 기준으로 결제일을 다시 잡는다', async () => {
    await blankSubscription()
    await trial('finance', at(2))
    const later = at(6)
    await trial('recruiting', later)
    await startSubscription(SPACE, ['finance', 'recruiting'])
    await cancelDeck(SPACE, 'finance')
    const s = await sub()
    expect(s.status).toBe('ACTIVE')
    expect(s.currentPeriodEnd).toEqual(later)
  })

  test('결제일 = 체험 종료일인 예약은 정기결제에서 한 달치 결제된다', async () => {
    await blankSubscription()
    await trial('finance', at(5))
    await startSubscription(SPACE, ['finance'])
    // 시간이 흘러 체험 종료·결제일 도래
    const ended = at(-0.01)
    await trial('finance', ended)
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE },
      data: { currentPeriodEnd: ended },
    })
    await runReservedStarts()
    await runDueCharges()
    expect(mockCharge).toHaveBeenCalledTimes(1)
    expect(mockCharge.mock.calls[0][0].amount).toBe(22000)
    expect((await item('finance')).awaitingTrialEnd).toBe(false)
    expect((await sub()).currentPeriodEnd!.getTime()).toBeGreaterThan(at(27).getTime())
  })

  test('체험이 연장되면(어떤 경로든) 결제하지 않고 결제일을 다시 맞춘다', async () => {
    await blankSubscription()
    await trial('finance', at(5))
    await startSubscription(SPACE, ['finance'])
    // 결제일은 지났지만 체험은 billing-admin SQL 등으로 연장됨
    const extended = at(10)
    await trial('finance', extended)
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE },
      data: { currentPeriodEnd: at(-0.01) },
    })
    await runReservedStarts()
    await runDueCharges()
    expect(mockCharge).not.toHaveBeenCalled()
    expect((await sub()).currentPeriodEnd).toEqual(extended)
  })

  test('같은 날이라도 체험 종료 시각이 결제일보다 늦으면 정기결제에서 제외된다', async () => {
    await paidSubscription(at(-0.01))
    await trial('recruiting', at(0.02))
    await prisma.subscriptionItem.create({
      data: {
        subscriptionId: (await sub()).id,
        deckAppId: 'recruiting',
        priceSnapshot: 20000,
        awaitingTrialEnd: true,
      },
    })
    await runDueCharges()
    expect(mockCharge).toHaveBeenCalledTimes(1)
    expect(mockCharge.mock.calls[0][0].amount).toBe(22000)
    expect((await item('recruiting')).awaitingTrialEnd).toBe(true)
  })

  test('활성 구독 중 체험이 끝나면 그날~결제일 일할 결제 (중복 실행 멱등)', async () => {
    await paidSubscription(at(20))
    await trial('recruiting', at(3))
    await addDeck(SPACE, 'recruiting')
    await trial('recruiting', at(-0.01))
    await runReservedStarts()
    await runReservedStarts()
    expect(mockCharge).toHaveBeenCalledTimes(1)
    const amount = mockCharge.mock.calls[0][0].amount
    expect(amount).toBeGreaterThan(0)
    expect(amount).toBeLessThan(22000)
    expect((await item('recruiting')).awaitingTrialEnd).toBe(false)
  })

  test('일할 예약 결제 실패는 그 업무만 재시도하고 소진되면 종료(보장가 유지)', async () => {
    await paidSubscription(at(20))
    await trial('recruiting', at(3))
    await addDeck(SPACE, 'recruiting')
    await prisma.subscriptionItem.updateMany({
      where: { deckAppId: 'recruiting', subscription: { spaceId: SPACE } },
      data: { lockedPrice: 12273 },
    })
    const ended = at(-0.01)
    await trial('recruiting', ended)
    mockCharge.mockResolvedValue({ ok: false, paymentKey: null, failReason: '한도 초과' })
    await runReservedStarts()
    expect((await item('recruiting')).billingRetryCount).toBe(1)
    expect((await sub()).status).toBe('ACTIVE')
    // 재시도 일정 전에는 시도하지 않는다
    await runReservedStarts()
    expect(mockCharge).toHaveBeenCalledTimes(1)
    for (const offset of [1, 3, 5])
      await runReservedStarts(new Date(ended.getTime() + offset * DAY + 1000))
    const r = await item('recruiting')
    expect(mockCharge).toHaveBeenCalledTimes(4)
    expect(r.status).toBe('ENDED')
    expect(r.lockedPrice).toBe(12273)
    expect((await item('finance')).status).toBe('ACTIVE')
    expect((await sub()).status).toBe('ACTIVE')
  })

  test('정기결제일까지 미납인 일할은 새 주기 결제에 합산된다', async () => {
    const periodEnd = at(-0.01)
    await paidSubscription(periodEnd)
    await trial('recruiting', at(-2))
    await prisma.subscriptionItem.create({
      data: {
        subscriptionId: (await sub()).id,
        deckAppId: 'recruiting',
        priceSnapshot: 20000,
        awaitingTrialEnd: true,
        billingRetryCount: 1,
      },
    })
    await runDueCharges()
    expect(mockCharge).toHaveBeenCalledTimes(1)
    // finance 22,000 + recruiting 한 달 22,000 + 미납 일할(2일치) > 44,000
    expect(mockCharge.mock.calls[0][0].amount).toBeGreaterThan(44000)
    const r = await item('recruiting')
    expect(r.awaitingTrialEnd).toBe(false)
    expect(r.billingRetryCount).toBe(0)
  })

  test('미납 일할 청구가 결과 불명이면 그 구독의 정기결제 전체를 보류한다', async () => {
    const periodEnd = at(-0.01)
    const s = await paidSubscription(periodEnd)
    const start = at(-2)
    await trial('recruiting', start)
    const created = await prisma.subscriptionItem.create({
      data: {
        subscriptionId: s.id,
        deckAppId: 'recruiting',
        priceSnapshot: 20000,
        awaitingTrialEnd: true,
      },
    })
    const { trialStartOrderId } = await import('../pricing')
    await prisma.billingCharge.create({
      data: {
        spaceId: SPACE,
        orderId: trialStartOrderId(created.id, start),
        supplyAmount: 1000,
        vatAmount: 100,
        amount: 1100,
        status: 'PENDING',
        provider: 'toss',
        periodStart: start,
        periodEnd,
        breakdown: [{ deckAppId: 'recruiting', type: 'DECK', price: 1000, prorated: true }],
        updatedAt: at(-1),
      },
    })
    mockLookup.mockRejectedValue(new Error('timeout'))
    await runDueCharges()
    expect(mockCharge).not.toHaveBeenCalled()
    expect((await sub()).currentPeriodEnd).toEqual(periodEnd)
  })

  test('체험 종료 후 예약 취소: 결과 불명이면 409, 청구 없으면 0원 종료', async () => {
    const s = await paidSubscription(at(20))
    const start = at(-0.5)
    await trial('recruiting', start)
    const created = await prisma.subscriptionItem.create({
      data: {
        subscriptionId: s.id,
        deckAppId: 'recruiting',
        priceSnapshot: 20000,
        awaitingTrialEnd: true,
      },
    })
    const { trialStartOrderId } = await import('../pricing')
    const pending = await prisma.billingCharge.create({
      data: {
        spaceId: SPACE,
        orderId: trialStartOrderId(created.id, start),
        supplyAmount: 1000,
        vatAmount: 100,
        amount: 1100,
        status: 'PENDING',
        provider: 'toss',
        periodStart: start,
        periodEnd: s.currentPeriodEnd!,
        breakdown: [{ deckAppId: 'recruiting', type: 'DECK', price: 1000, prorated: true }],
      },
    })
    await expect(cancelDeck(SPACE, 'recruiting')).rejects.toMatchObject({ status: 409 })
    await prisma.billingCharge.delete({ where: { id: pending.id } })
    const result = await cancelDeck(SPACE, 'recruiting')
    expect(result).toEqual({ effectiveAt: null, reservationCanceled: true })
    expect((await item('recruiting')).status).toBe('ENDED')
    expect((await sub()).status).toBe('ACTIVE')
  })

  test('체험 종료 후 예약 취소: 승인 확인되면 결제된 구독의 기간말 해지가 된다', async () => {
    const s = await paidSubscription(at(20))
    const start = at(-0.5)
    await trial('recruiting', start)
    const created = await prisma.subscriptionItem.create({
      data: {
        subscriptionId: s.id,
        deckAppId: 'recruiting',
        priceSnapshot: 20000,
        awaitingTrialEnd: true,
      },
    })
    const { trialStartOrderId } = await import('../pricing')
    await prisma.billingCharge.create({
      data: {
        spaceId: SPACE,
        orderId: trialStartOrderId(created.id, start),
        supplyAmount: 1000,
        vatAmount: 100,
        amount: 1100,
        status: 'PENDING',
        provider: 'toss',
        periodStart: start,
        periodEnd: s.currentPeriodEnd!,
        breakdown: [{ deckAppId: 'recruiting', type: 'DECK', price: 1000, prorated: true }],
        updatedAt: at(-0.4),
      },
    })
    mockLookup.mockResolvedValue({ status: 'DONE', paymentKey: 'approved-pk' })
    const result = await cancelDeck(SPACE, 'recruiting')
    expect(result.effectiveAt).toEqual(s.currentPeriodEnd)
    const r = await item('recruiting')
    expect(r.status).toBe('CANCEL_AT_PERIOD_END')
    expect(r.awaitingTrialEnd).toBe(false)
  })

  test('어드민 체험 연장: 예약 업무도 연장되고 예약 전용 구독의 첫 결제일이 따라간다', async () => {
    await blankSubscription()
    await trial('finance', at(5))
    await startSubscription(SPACE, ['finance'])
    const result = await updateSubscriptionAccess('local-test-operator', SPACE, 'finance', {
      trialEndsOn: '2030-12-31',
      note: '예약 연장 검증',
    })
    expect(result.trialEndsAt).toBe('2030-12-31T15:00:00.000Z')
    expect((await sub()).currentPeriodEnd!.toISOString()).toBe('2030-12-31T15:00:00.000Z')
    expect((await item('finance')).awaitingTrialEnd).toBe(true)
  })

  test('이미 승인된(PAID) 일할 청구가 있으면 예약 취소가 아니라 결제된 구독 해지가 된다', async () => {
    const s = await paidSubscription(at(20))
    const start = at(-0.5)
    await trial('recruiting', start)
    const created = await prisma.subscriptionItem.create({
      data: {
        subscriptionId: s.id,
        deckAppId: 'recruiting',
        priceSnapshot: 20000,
        awaitingTrialEnd: true,
      },
    })
    const { trialStartOrderId } = await import('../pricing')
    await prisma.billingCharge.create({
      data: {
        spaceId: SPACE,
        orderId: trialStartOrderId(created.id, start),
        supplyAmount: 1000,
        vatAmount: 100,
        amount: 1100,
        status: 'PAID',
        provider: 'toss',
        paymentKey: 'paid-pk',
        periodStart: start,
        periodEnd: s.currentPeriodEnd!,
        breakdown: [{ deckAppId: 'recruiting', type: 'DECK', price: 1000, prorated: true }],
      },
    })
    const result = await cancelDeck(SPACE, 'recruiting')
    expect(result.reservationCanceled).toBe(false)
    expect((await item('recruiting')).status).toBe('CANCEL_AT_PERIOD_END')
  })

  test('예약 취소 뒤에는 cron 이 예전 예약으로 일할 청구를 만들지 않는다', async () => {
    const s = await paidSubscription(at(20))
    await trial('recruiting', at(-0.5))
    const created = await prisma.subscriptionItem.create({
      data: {
        subscriptionId: s.id,
        deckAppId: 'recruiting',
        priceSnapshot: 20000,
        awaitingTrialEnd: true,
      },
    })
    // cron 이 예약을 읽은 직후 취소가 끝난 상황: 아이템만 종료 상태로 바꾼 뒤 실행
    await prisma.subscriptionItem.update({
      where: { id: created.id },
      data: { status: 'ENDED', endedAt: new Date() },
    })
    await runReservedStarts()
    expect(mockCharge).not.toHaveBeenCalled()
    expect(await prisma.billingCharge.count({ where: { spaceId: SPACE } })).toBe(0)
  })

  test('예약 전용 구독에 /start 를 다시 호출해도 기존 예약과 보장가를 지우지 않는다', async () => {
    await blankSubscription()
    await trial('finance', at(5))
    await startSubscription(SPACE, ['finance'])
    await prisma.subscriptionItem.updateMany({
      where: { deckAppId: 'finance', subscription: { spaceId: SPACE } },
      data: { lockedPrice: 12273 },
    })
    await startSubscription(SPACE, ['recruiting'])
    const f = await item('finance')
    expect(f.status).toBe('ACTIVE')
    expect(f.awaitingTrialEnd).toBe(true)
    expect(f.lockedPrice).toBe(12273)
    expect((await item('recruiting')).awaitingTrialEnd).toBe(false)
  })

  test('미납(PAST_DUE) 구독에는 업무 추가가 막힌다(지난 결제일 기준 1일치 결제 방지)', async () => {
    await paidSubscription(at(-2))
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE },
      data: { status: 'PAST_DUE', retryCount: 1 },
    })
    await expect(addDeck(SPACE, 'recruiting')).rejects.toMatchObject({ status: 409 })
    expect(mockCharge).not.toHaveBeenCalled()
  })

  test('미납 중인 예약 전용 구독에서 예약을 취소하면 결제일이 바뀌고 재시도가 다시 시작된다', async () => {
    await blankSubscription()
    const first = at(-1)
    await trial('finance', at(3))
    await trial('recruiting', at(6))
    await startSubscription(SPACE, ['finance', 'recruiting'])
    await trial('finance', first)
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE },
      data: { status: 'PAST_DUE', retryCount: 1, currentPeriodEnd: first },
    })
    await cancelDeck(SPACE, 'finance')
    const s = await sub()
    expect(s.status).toBe('ACTIVE')
    expect(s.retryCount).toBe(0)
    expect(s.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now())
  })

  test('같은 아이템의 과거 예약 결제 이력은 이번 예약 취소를 결제된 해지로 바꾸지 않는다', async () => {
    const s = await paidSubscription(at(20))
    const oldStart = at(-40)
    await trial('recruiting', at(5))
    const created = await prisma.subscriptionItem.create({
      data: {
        subscriptionId: s.id,
        deckAppId: 'recruiting',
        priceSnapshot: 20000,
        awaitingTrialEnd: true,
      },
    })
    const { trialStartOrderId } = await import('../pricing')
    await prisma.billingCharge.create({
      data: {
        spaceId: SPACE,
        orderId: trialStartOrderId(created.id, oldStart),
        supplyAmount: 1000,
        vatAmount: 100,
        amount: 1100,
        status: 'PAID',
        provider: 'toss',
        paymentKey: 'old-pk',
        periodStart: oldStart,
        periodEnd: at(-30),
        breakdown: [{ deckAppId: 'recruiting', type: 'DECK', price: 1000, prorated: true }],
      },
    })
    const result = await cancelDeck(SPACE, 'recruiting')
    expect(result).toEqual({ effectiveAt: null, reservationCanceled: true })
    expect((await item('recruiting')).status).toBe('ENDED')
  })
})
