/** @jest-environment node */
// 격리된 로컬 DB와 가짜 PG 응답으로 실제 transaction·권한 변화를 검증한다.
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })
const mockStatus = jest.fn()
const mockCharge = jest.fn().mockResolvedValue({ ok: true, paymentKey: 'new-pk' })
jest.mock('@/lib/crypto/field-crypto', () => ({ decryptField: () => 'local-key' }))
jest.mock('@/lib/crypto/reencrypt', () => ({ upgradeIfLegacy: async () => {} }))
jest.mock('@/lib/billing/deck-release', () => ({ findClosedDecks: async () => [] }))
jest.mock('@/lib/billing/providers/toss', () => ({
  getBillingProvider: () => ({
    id: 'toss',
    charge: mockCharge,
    parseWebhook: () => ({ orderId: 'refund-e2e-order', paymentKey: 'local-pk' }),
    fetchPaymentStatus: mockStatus,
  }),
}))
import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { resolveEntitlement } from '@/lib/billing/entitlement'
import { addDeck, cancelDeck } from '@/lib/billing/subscription-service'

const run = /@(127\.0\.0\.1|localhost):55471\/deck_trials/.test(process.env.DATABASE_URL ?? '')
const suite = run ? describe : describe.skip
const spaceId = 'test-full-refund-isolated'
const start = new Date(),
  end = new Date(start.getTime() + 30 * 86400000)
const request = () =>
  new NextRequest('http://localhost/api/billing/toss/webhook?secret=local-secret', {
    method: 'POST',
    body: '{}',
  })
suite('전액 환불 실 DB 동기화', () => {
  beforeEach(async () => {
    delete process.env.BILLING_CHECKOUT_PAUSED
    mockCharge.mockClear()
    process.env.TOSS_WEBHOOK_SECRET = 'local-secret'
    mockStatus.mockResolvedValue({ orderId: 'refund-e2e-order', status: 'CANCELED' })
    await prisma.space.deleteMany({ where: { id: spaceId } })
    await prisma.space.create({ data: { id: spaceId, name: '환불 회귀 전용' } })
    await prisma.spaceSubscription.create({
      data: {
        spaceId,
        status: 'ACTIVE',
        currentPeriodEnd: end,
        items: {
          create: {
            deckAppId: 'recruiting',
            type: 'DECK',
            status: 'CANCEL_AT_PERIOD_END',
            priceSnapshot: 10000,
            lockedPrice: 10000,
          },
        },
      },
    })
    await prisma.billingCharge.create({
      data: {
        spaceId,
        orderId: 'refund-e2e-order',
        status: 'REFUNDED',
        provider: 'toss',
        paymentKey: 'local-pk',
        amount: 11000,
        supplyAmount: 10000,
        vatAmount: 1000,
        periodStart: start,
        periodEnd: end,
        breakdown: [{ type: 'DECK', deckAppId: 'recruiting', price: 10000 }],
      },
    })
  })
  afterAll(async () => {
    await prisma.billingDeckProduct.deleteMany({ where: { id: 'refund-test-new-deck' } })
    await prisma.space.deleteMany({ where: { id: spaceId } })
    await prisma.$disconnect()
  })
  test('이미 REFUNDED인 청구의 해지 예정 상태를 복구하며 반복 수신도 안전하다', async () => {
    for (let i = 0; i < 2; i++) expect((await POST(request())).status).toBe(200)
    const s = await prisma.spaceSubscription.findUniqueOrThrow({
      where: { spaceId },
      include: { items: true },
    })
    expect(s.status).toBe('CANCELED')
    expect(s.currentPeriodEnd).toBeNull()
    expect(s.items[0].status).toBe('ENDED')
    expect(s.items[0].lockedPrice).toBeNull()
  })
  test('같은 공간의 다른 유료 업무는 유지한다', async () => {
    const s = await prisma.spaceSubscription.findUniqueOrThrow({ where: { spaceId } })
    await prisma.subscriptionItem.create({
      data: { subscriptionId: s.id, deckAppId: 'finance', priceSnapshot: 20000, addedAt: start },
    })
    expect((await POST(request())).status).toBe(200)
    const result = await prisma.spaceSubscription.findUniqueOrThrow({
      where: { spaceId },
      include: { items: true },
    })
    expect(result.status).toBe('ACTIVE')
    expect(result.items.find((i) => i.deckAppId === 'finance')?.status).toBe('ACTIVE')
    expect(result.items.find((i) => i.deckAppId === 'recruiting')?.status).toBe('ENDED')
  })
  test('부분 취소는 PAID 결제와 유료 이용 상태를 유지한다', async () => {
    await prisma.billingCharge.update({
      where: { orderId: 'refund-e2e-order' },
      data: { status: 'PAID' },
    })
    mockStatus.mockResolvedValue({ orderId: 'refund-e2e-order', status: 'PARTIAL_CANCELED' })
    expect((await POST(request())).status).toBe(200)
    expect(
      (await prisma.billingCharge.findUniqueOrThrow({ where: { orderId: 'refund-e2e-order' } }))
        .status
    ).toBe('PAID')
    expect((await prisma.spaceSubscription.findUniqueOrThrow({ where: { spaceId } })).status).toBe(
      'ACTIVE'
    )
  })
  test('환불이 먼저 완료되면 오래된 구독 정보로 추가 결제를 시작하지 않는다', async () => {
    await prisma.billingDeckProduct.upsert({
      where: { id: 'refund-test-new-deck' },
      create: {
        id: 'refund-test-new-deck',
        name: '회귀 전용',
        monthlyPrice: 10000,
        pricingMode: 'SUBSCRIPTION',
      },
      update: {},
    })
    await prisma.billingMethod.create({
      data: { spaceId, provider: 'toss', billingKey: 'local', billingKeyIv: 'local' },
    })
    const original = prisma.subscriptionItem.upsert.bind(prisma.subscriptionItem)
    const spy = jest.spyOn(prisma.subscriptionItem, 'upsert').mockImplementation(((
      args: Parameters<typeof original>[0]
    ) =>
      original(args).then(async (result) => {
        expect((await POST(request())).status).toBe(200)
        return result
      })) as never)
    try {
      await expect(addDeck(spaceId, 'refund-test-new-deck')).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('구독 상태가 변경'),
      })
      expect(mockCharge).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
  test.each(['cancel', 'resume'])(
    '환불 후 %s 예약 상태 변경이 종료된 업무를 되살리지 않는다',
    async (action) => {
      const subscription = await prisma.spaceSubscription.findUniqueOrThrow({ where: { spaceId } })
      await prisma.subscriptionItem.create({
        data: { subscriptionId: subscription.id, deckAppId: 'finance', priceSnapshot: 20000 },
      })
      if (action === 'cancel')
        await prisma.subscriptionItem.updateMany({
          where: { subscriptionId: subscription.id, deckAppId: 'recruiting' },
          data: { status: 'ACTIVE' },
        })
      await prisma.billingMethod.create({
        data: { spaceId, provider: 'toss', billingKey: 'local', billingKeyIv: 'local' },
      })
      const original = prisma.spaceSubscription.findUnique.bind(prisma.spaceSubscription)
      const spy = jest.spyOn(prisma.spaceSubscription, 'findUnique').mockImplementation(((
        args: Parameters<typeof original>[0]
      ) =>
        original(args).then(async (result) => {
          if (args.include?.items) {
            spy.mockRestore()
            expect((await POST(request())).status).toBe(200)
          }
          return result
        })) as never)
      try {
        await expect(
          action === 'cancel' ? cancelDeck(spaceId, 'recruiting') : addDeck(spaceId, 'recruiting')
        ).rejects.toMatchObject({ status: 409 })
        const state = await prisma.spaceSubscription.findUniqueOrThrow({
          where: { spaceId },
          include: { items: true },
        })
        expect(state.status).toBe('ACTIVE')
        expect(state.items.find((i) => i.deckAppId === 'recruiting')?.status).toBe('ENDED')
        expect((await resolveEntitlement(spaceId)).decks.recruiting.reason).not.toBe('SUBSCRIBED')
      } finally {
        spy.mockRestore()
      }
    }
  )
})
