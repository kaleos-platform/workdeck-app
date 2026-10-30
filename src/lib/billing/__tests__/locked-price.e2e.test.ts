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
const mockLookup = jest.fn()
jest.mock('@/lib/billing/providers/toss', () => ({
  getBillingProvider: () => ({
    id: 'toss',
    issueBillingKey: mockIssue,
    charge: mockCharge,
    cancel: jest.fn(),
    parseWebhook: jest.fn(),
    fetchPaymentStatus: jest.fn(),
    fetchPaymentByOrderId: mockLookup,
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
const SPACE_C = 'e2e-locked-price-c' // EXPIRED 재시작
const SPACE_D = 'e2e-locked-price-d' // 일할 추가: 거절 후 재시도 성공
const SPACE_E = 'e2e-locked-price-e' // 일할 추가: 거절 후 재시도도 거절
const SPACE_F = 'e2e-locked-price-f' // 구독 시작: 거절 후 재시도
const SPACE_G = 'e2e-locked-price-g' // 응답 유실 + 조회 DONE
const SPACE_H = 'e2e-locked-price-h' // 응답 유실 + 조회 실패 → 차단 → stale 조회 DONE
const SPACE_I = 'e2e-locked-price-i' // 일할 추가 stale PENDING + 조회 DONE
const SPACE_J = 'e2e-locked-price-j' // 중복 주문 오류 + 조회 DONE
const ALL_SPACES = [
  SPACE_A,
  SPACE_B,
  SPACE_C,
  SPACE_D,
  SPACE_E,
  SPACE_F,
  SPACE_G,
  SPACE_H,
  SPACE_I,
  SPACE_J,
]
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
  const ids = ALL_SPACES
  await prisma.billingCharge.deleteMany({ where: { spaceId: { in: ids } } })
  await prisma.billingMethod.deleteMany({ where: { spaceId: { in: ids } } })
  await prisma.spaceSubscription.deleteMany({ where: { spaceId: { in: ids } } })
  await prisma.space.deleteMany({ where: { id: { in: ids } } })
}

// billing-admin.mjs migrate-grant 와 같은 상태: 체험 종료일 + ENDED 모집 관리 item(보장가)
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
      data: ALL_SPACES.map((id) => ({ id, name: id })),
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
    mockLookup.mockReset()
  })

  it('체험(trialEndsAt) 동안 허용, 경과하면 잠김', async () => {
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

  // 결제수단 + 다른 업무(finance) 구독 중 + 이전 고객 보장가 부여 상태
  async function activeWithGrant(spaceId: string) {
    await registerCard(spaceId)
    mockCharge.mockResolvedValue({ ok: true, paymentKey: `pay_${spaceId}_0`, failReason: null })
    await startSubscription(spaceId, ['finance'])
    await grant(spaceId, new Date(Date.now() + 30 * 86400000))
  }

  async function charges(spaceId: string, prefix: string) {
    return prisma.billingCharge.findMany({
      where: { spaceId, orderId: { startsWith: prefix } },
    })
  }

  it('EXPIRED 재시작에서 모집 관리를 다시 고르면 보장가 유지', async () => {
    await grant(SPACE_C, new Date(Date.now() + 30 * 86400000))
    await registerCard(SPACE_C)
    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_c1', failReason: null })
    await startSubscription(SPACE_C, ['recruiting'])

    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE_C },
      data: { status: 'EXPIRED' },
    })
    await prisma.billingCharge.deleteMany({
      where: { spaceId: SPACE_C, orderId: { startsWith: 'substart_' } },
    })
    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_c2', failReason: null })
    const r = await startSubscription(SPACE_C, ['recruiting'])
    expect(r.amount).toBe(13500)

    const item = await recruitingItem(SPACE_C)
    expect(item?.status).toBe('ACTIVE')
    expect(item?.lockedPrice).toBe(LOCKED)
    expect(item?.priceSnapshot).toBe(LOCKED)
  })

  it('일할 추가: 카드 거절 후 같은 날 재시도 성공 → 결제·ACTIVE·보장가 유지', async () => {
    await activeWithGrant(SPACE_D)

    mockCharge.mockResolvedValue({ ok: false, paymentKey: null, failReason: 'REJECT_CARD' })
    await expect(addDeck(SPACE_D, 'recruiting')).rejects.toMatchObject({ status: 402 })
    const declined = await recruitingItem(SPACE_D)
    expect(declined?.status).toBe('ENDED')
    expect(declined?.lockedPrice).toBe(LOCKED)
    expect((await charges(SPACE_D, 'prorate_')).map((c) => c.status)).toEqual(['FAILED'])

    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_d1', failReason: null })
    const r = await addDeck(SPACE_D, 'recruiting')
    expect(r.prorated).toBe(true)
    expect(r.amount).toBeGreaterThan(0)

    const item = await recruitingItem(SPACE_D)
    expect(item?.status).toBe('ACTIVE')
    expect(item?.priceSnapshot).toBe(LOCKED)
    expect(item?.lockedPrice).toBe(LOCKED)
    const rows = await charges(SPACE_D, 'prorate_')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('PAID')
    expect(rows[0].paymentKey).toBe('pay_d1')
    // 같은 orderId 로 재청구 (새 orderId 로 이중 결제되지 않음)
    expect(mockCharge.mock.calls.at(-1)![0].orderId).toBe(rows[0].orderId)
  })

  it('일할 추가: 거절 후 재시도도 거절 → 업무는 ACTIVE 가 아님', async () => {
    await activeWithGrant(SPACE_E)

    mockCharge.mockResolvedValue({ ok: false, paymentKey: null, failReason: 'REJECT_CARD' })
    await expect(addDeck(SPACE_E, 'recruiting')).rejects.toMatchObject({ status: 402 })
    await expect(addDeck(SPACE_E, 'recruiting')).rejects.toMatchObject({ status: 402 })

    const item = await recruitingItem(SPACE_E)
    expect(item?.status).toBe('ENDED')
    expect(item?.lockedPrice).toBe(LOCKED)
    expect((await charges(SPACE_E, 'prorate_')).map((c) => c.status)).toEqual(['FAILED'])
  })

  it('구독 시작: 카드 거절 후 같은 날 재시도 가능, 보장가 청구', async () => {
    await grant(SPACE_F, new Date(Date.now() + 30 * 86400000))
    await registerCard(SPACE_F)

    mockCharge.mockResolvedValue({ ok: false, paymentKey: null, failReason: 'REJECT_CARD' })
    await expect(startSubscription(SPACE_F, ['recruiting'])).rejects.toMatchObject({ status: 402 })
    expect((await recruitingItem(SPACE_F))?.status).toBe('ENDED')

    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_f1', failReason: null })
    const r = await startSubscription(SPACE_F, ['recruiting'])
    expect(r.amount).toBe(13500)
    expect((await recruitingItem(SPACE_F))?.status).toBe('ACTIVE')
    const rows = await charges(SPACE_F, 'substart_')
    expect(rows.map((c) => c.status)).toEqual(['PAID'])

    // PAID 이후 같은 날 재호출은 여전히 409 (중복 시작 차단)
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE_F },
      data: { status: 'EXPIRED' },
    })
    await expect(startSubscription(SPACE_F, ['recruiting'])).rejects.toMatchObject({ status: 409 })
  })

  const done = (paymentKey: string) => ({ paymentKey, orderId: 'x', status: 'DONE' })
  const staleAgo = () => new Date(Date.now() - 10 * 60 * 1000)

  it('일할 추가: 응답 유실(예외) + 조회 DONE → PAID·ACTIVE, 재청구 없음', async () => {
    await activeWithGrant(SPACE_G)
    mockCharge.mockReset()
    mockCharge.mockRejectedValue(new Error('network timeout'))
    mockLookup.mockResolvedValue(done('pay_g1'))

    const r = await addDeck(SPACE_G, 'recruiting')
    expect(r.prorated).toBe(true)
    expect(mockCharge).toHaveBeenCalledTimes(1)
    expect((await recruitingItem(SPACE_G))?.status).toBe('ACTIVE')
    const rows = await charges(SPACE_G, 'prorate_')
    expect(rows.map((c) => [c.status, c.paymentKey])).toEqual([['PAID', 'pay_g1']])
  })

  it('구독 시작: 예외 + 조회 실패 → PENDING 유지·차단(다른 날 orderId 도), 5분 경과 후 조회 DONE 이면 이어받아 활성화', async () => {
    await grant(SPACE_H, new Date(Date.now() + 30 * 86400000))
    await registerCard(SPACE_H)
    mockCharge.mockRejectedValue(new Error('network timeout'))
    mockLookup.mockRejectedValue(new Error('lookup down'))

    await expect(startSubscription(SPACE_H, ['recruiting'])).rejects.toMatchObject({ status: 409 })
    const [pending] = await charges(SPACE_H, 'substart_')
    expect(pending.status).toBe('PENDING')
    expect((await recruitingItem(SPACE_H))?.status).toBe('ENDED')
    expect(mockCharge).toHaveBeenCalledTimes(1)

    // 다음 날: orderId 가 달라져도 PENDING 이 있으면 새 결제 금지
    await prisma.billingCharge.update({
      where: { id: pending.id },
      data: { orderId: pending.orderId.replace(/\d{8}$/, '20200101') },
    })
    await expect(startSubscription(SPACE_H, ['recruiting'])).rejects.toMatchObject({ status: 409 })
    expect(mockCharge).toHaveBeenCalledTimes(1)

    // 5분 경과 + 조회 실패 → 계속 차단
    await prisma.billingCharge.update({
      where: { id: pending.id },
      data: { updatedAt: staleAgo() },
    })
    await expect(startSubscription(SPACE_H, ['recruiting'])).rejects.toMatchObject({ status: 409 })
    expect(mockCharge).toHaveBeenCalledTimes(1)

    // 조회 복구 → 승인 확인된 청구를 이어받아 결제 호출 없이 활성화
    mockLookup.mockResolvedValue(done('pay_h1'))
    const r = await startSubscription(SPACE_H, ['recruiting'])
    expect(r.amount).toBe(13500)
    expect(mockCharge).toHaveBeenCalledTimes(1)
    expect((await recruitingItem(SPACE_H))?.status).toBe('ACTIVE')
    const rows = await charges(SPACE_H, 'substart_')
    expect(rows.map((c) => [c.status, c.paymentKey])).toEqual([['PAID', 'pay_h1']])
  })

  it('일할 추가: stale PENDING + 조회 DONE → PAID·ACTIVE, 재청구 없음', async () => {
    await activeWithGrant(SPACE_I)
    mockCharge.mockReset()
    mockCharge.mockRejectedValue(new Error('network timeout'))
    mockLookup.mockRejectedValue(new Error('lookup down'))
    await expect(addDeck(SPACE_I, 'recruiting')).rejects.toMatchObject({ status: 409 })
    const [pending] = await charges(SPACE_I, 'prorate_')
    expect(pending.status).toBe('PENDING')

    await prisma.billingCharge.update({
      where: { id: pending.id },
      data: { updatedAt: staleAgo() },
    })
    mockLookup.mockResolvedValue(done('pay_i1'))
    await addDeck(SPACE_I, 'recruiting')
    expect(mockCharge).toHaveBeenCalledTimes(1)
    expect((await recruitingItem(SPACE_I))?.status).toBe('ACTIVE')
    expect((await charges(SPACE_I, 'prorate_')).map((c) => c.status)).toEqual(['PAID'])
  })

  it('구독 시작: 중복 주문 오류 + 조회 DONE → 성공 처리', async () => {
    await grant(SPACE_J, new Date(Date.now() + 30 * 86400000))
    await registerCard(SPACE_J)
    mockCharge.mockResolvedValue({
      ok: false,
      paymentKey: null,
      failReason: 'ALREADY_PROCESSED_PAYMENT: 이미 처리된 결제',
      unknown: true,
    })
    mockLookup.mockResolvedValue(done('pay_j1'))

    const r = await startSubscription(SPACE_J, ['recruiting'])
    expect(r.amount).toBe(13500)
    expect((await recruitingItem(SPACE_J))?.status).toBe('ACTIVE')
    expect((await charges(SPACE_J, 'substart_')).map((c) => [c.status, c.paymentKey])).toEqual([
      ['PAID', 'pay_j1'],
    ])
  })
})
