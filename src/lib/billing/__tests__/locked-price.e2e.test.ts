/**
 * 이전 고객 보장가(lockedPrice) e2e — 실 dev DB + 모킹 PG provider.
 *
 * 규칙: 이전 고객은 모집 관리 item 에 lockedPrice(공급가)를 갖고, 구독을 유지하는 동안
 * 최초 청구·일할 추가·정기청구 모두 그 가격을 쓴다. 실제 해지(주기말 ENDED)되면
 * lockedPrice 가 사라져 재구독은 정가.
 *
 * 실행: npx jest -c jest.config.e2e.ts src/lib/billing/__tests__/locked-price --runInBand
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

const mockCharge = jest.fn()
const mockIssue = jest.fn()
jest.mock('@/lib/billing/providers/toss', () => ({
  getBillingProvider: () => ({
    id: 'toss',
    issueBillingKey: mockIssue,
    charge: mockCharge,
    cancel: jest.fn(),
    parseWebhook: jest.fn(),
    fetchPaymentStatus: jest.fn(),
  }),
  tossProvider: {},
}))

import { prisma } from '@/lib/prisma'
import {
  ensureCustomerKey,
  registerBillingMethod,
  startSubscription,
  addDeck,
  cancelDeck,
  runDueCharges,
} from '@/lib/billing/subscription-service'
import { resolveEntitlement } from '@/lib/billing/entitlement'
import { calcAmounts } from '@/lib/billing/pricing'

const SPACE_A = 'e2e-locked-price-a'
const SPACE_B = 'e2e-locked-price-b'
const LOCKED = 12273 // VAT 포함 13,500
const RUN =
  !!(process.env.DATABASE_URL || process.env.DIRECT_URL) && !!process.env.ENCRYPTION_KEY_V1

let original: Array<{
  id: string
  pricingMode: 'FREE_BETA' | 'SUBSCRIPTION'
  paidActivatedAt: Date | null
}> = []
let listPrice = 0

async function cleanup() {
  const ids = [SPACE_A, SPACE_B]
  await prisma.billingCharge.deleteMany({ where: { spaceId: { in: ids } } })
  await prisma.billingMethod.deleteMany({ where: { spaceId: { in: ids } } })
  await prisma.spaceSubscription.deleteMany({ where: { spaceId: { in: ids } } })
  await prisma.space.deleteMany({ where: { id: { in: ids } } })
}

// billing-admin.mjs migrate-grant 와 같은 상태: 무료 기간 + ENDED 모집 관리 item(보장가)
async function grant(spaceId: string, trialEndsAt: Date) {
  const sub = await prisma.spaceSubscription.upsert({
    where: { spaceId },
    create: { spaceId, status: 'TRIALING', trialEndsAt },
    update: { trialEndsAt },
  })
  await prisma.subscriptionItem.create({
    data: {
      subscriptionId: sub.id,
      type: 'DECK',
      deckAppId: 'recruiting',
      priceSnapshot: LOCKED,
      lockedPrice: LOCKED,
      status: 'ENDED',
      endedAt: new Date(),
    },
  })
}

async function recruitingItem(spaceId: string) {
  return prisma.subscriptionItem.findFirst({
    where: { subscription: { spaceId }, deckAppId: 'recruiting' },
  })
}

async function registerCard(spaceId: string) {
  mockIssue.mockResolvedValue({ billingKey: `bk_${spaceId}`, cardSummary: '신한 ****1234' })
  await ensureCustomerKey(spaceId)
  await registerBillingMethod(spaceId, 'auth_key_test')
}

const d = RUN ? describe : describe.skip

d('이전 고객 보장가 lockedPrice (모킹 PG + 실 DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.createMany({
      data: [
        { id: SPACE_A, name: 'e2e-locked-a' },
        { id: SPACE_B, name: 'e2e-locked-b' },
      ],
    })
    const ids = ['recruiting', 'finance']
    const rows = await prisma.billingDeckProduct.findMany({ where: { id: { in: ids } } })
    original = rows.map((r) => ({
      id: r.id,
      pricingMode: r.pricingMode,
      paidActivatedAt: r.paidActivatedAt,
    }))
    await prisma.billingDeckProduct.updateMany({
      where: { id: { in: ids } },
      data: { pricingMode: 'SUBSCRIPTION', paidActivatedAt: new Date('2020-01-01T00:00:00Z') },
    })
    listPrice = rows.find((r) => r.id === 'recruiting')!.monthlyPrice
    expect(listPrice).toBeGreaterThan(LOCKED)
  })

  afterAll(async () => {
    for (const m of original) {
      await prisma.billingDeckProduct.update({
        where: { id: m.id },
        data: { pricingMode: m.pricingMode, paidActivatedAt: m.paidActivatedAt },
      })
    }
    await cleanup()
    await prisma.$disconnect()
  })

  beforeEach(() => {
    mockCharge.mockReset()
    mockIssue.mockReset()
  })

  it('무료 기간(trialEndsAt) 동안 허용, 경과하면 잠김', async () => {
    await grant(SPACE_A, new Date(Date.now() + 30 * 86400000))
    expect((await resolveEntitlement(SPACE_A)).decks['recruiting'].reason).toBe('TRIAL')

    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE_A },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    })
    expect((await resolveEntitlement(SPACE_A)).decks['recruiting'].reason).toBe('LOCKED')
  })

  it('구독 시작 최초 청구는 보장가 13,500', async () => {
    await registerCard(SPACE_A)
    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_a1', failReason: null })

    const r = await startSubscription(SPACE_A, ['recruiting'])
    expect(r.amount).toBe(13500)

    const item = await recruitingItem(SPACE_A)
    expect(item?.status).toBe('ACTIVE')
    expect(item?.priceSnapshot).toBe(LOCKED)
    expect(item?.lockedPrice).toBe(LOCKED)
  })

  it('정기청구도 13,500', async () => {
    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_a2', failReason: null })
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE_A },
      data: { currentPeriodEnd: new Date(Date.now() - 3600_000) },
    })
    const r = await runDueCharges()
    expect(r.find((x) => x.spaceId === SPACE_A)?.outcome).toBe('paid')
    expect(mockCharge.mock.calls.at(-1)![0].amount).toBe(13500)
  })

  it('해제 예약 취소(재추가)는 보장가 유지', async () => {
    await cancelDeck(SPACE_A, 'recruiting')
    const r = await addDeck(SPACE_A, 'recruiting')
    expect(r).toEqual({ prorated: false, amount: 0 })
    const item = await recruitingItem(SPACE_A)
    expect(item?.lockedPrice).toBe(LOCKED)
    expect(item?.priceSnapshot).toBe(LOCKED)
  })

  it('실제 해지(주기말 종료) 후 재구독은 정가', async () => {
    await cancelDeck(SPACE_A, 'recruiting')
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE_A },
      data: { currentPeriodEnd: new Date(Date.now() - 7300_000) },
    })
    const r1 = await runDueCharges()
    expect(r1.find((x) => x.spaceId === SPACE_A)?.outcome).toBe('canceled')

    const ended = await recruitingItem(SPACE_A)
    expect(ended?.status).toBe('ENDED')
    expect(ended?.lockedPrice).toBeNull()

    // startOrderId 는 일 단위 멱등 키 — 같은 날 첫 시작 청구가 남아 있으면 409
    await prisma.billingCharge.deleteMany({
      where: { spaceId: SPACE_A, orderId: { startsWith: 'substart_' } },
    })
    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_a3', failReason: null })
    const r2 = await startSubscription(SPACE_A, ['recruiting'])
    expect(r2.amount).toBe(calcAmounts(listPrice).amount)
    expect((await recruitingItem(SPACE_A))?.priceSnapshot).toBe(listPrice)
  })

  it('다른 업무 구독 중 추가(일할)도 보장가 기준', async () => {
    await registerCard(SPACE_B)
    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_b1', failReason: null })
    await startSubscription(SPACE_B, ['finance'])
    await grant(SPACE_B, new Date(Date.now() + 30 * 86400000))

    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_b2', failReason: null })
    const r = await addDeck(SPACE_B, 'recruiting')
    expect(r.prorated).toBe(true)
    expect(r.amount).toBeGreaterThan(0)
    expect(r.amount).toBeLessThanOrEqual(13500)

    const item = await recruitingItem(SPACE_B)
    expect(item?.priceSnapshot).toBe(LOCKED)
    expect(item?.lockedPrice).toBe(LOCKED)
  })

  it('만료 후 재시작에서 모집 관리를 고르지 않으면 보장가 소멸', async () => {
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE_B },
      data: { status: 'EXPIRED' },
    })
    await prisma.billingCharge.deleteMany({
      where: { spaceId: SPACE_B, orderId: { startsWith: 'substart_' } },
    })
    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_b3', failReason: null })
    await startSubscription(SPACE_B, ['finance'])

    const item = await recruitingItem(SPACE_B)
    expect(item?.status).toBe('ENDED')
    expect(item?.lockedPrice).toBeNull()
  })
})
