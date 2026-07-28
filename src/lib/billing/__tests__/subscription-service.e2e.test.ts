/**
 * 구독 서비스 e2e — 실 dev DB + 모킹 PG provider.
 *
 * 커버: 카드등록→구독시작(첫결제)→entitlement 반영, cron 멱등(같은 주기 중복 결제 0),
 * dunning(실패 3회→EXPIRED), deck 중도추가 일할결제, 해제 예약→주기말 종료.
 * 토스 실호출 없음(provider 모킹) — 실 API 검증은 preview 수동 QA에서 테스트키로 수행.
 *
 * throwaway space 시드, afterAll 0-state 복원. DB URL 없으면 skip.
 * 실행: npx jest -c jest.config.e2e.ts src/lib/billing --runInBand
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

// PG provider 모킹 — 도메인 로직만 검증
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
import { resolveEntitlement, ensureTrialStarted } from '@/lib/billing/entitlement'

const SPACE_ID = 'e2e-billing-space-0001'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL) && !!process.env.ENCRYPTION_KEY

async function cleanup() {
  await prisma.billingCharge.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.billingMethod.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.spaceSubscription.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.deckInstance.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

// 테스트용: coupang-ads·finance를 유료 모드로 스냅샷 전환 후 복원
let originalModes: Array<{
  id: string
  pricingMode: 'FREE_BETA' | 'SUBSCRIPTION'
  paidActivatedAt: Date | null
}> = []

async function setPaidMode(ids: string[]) {
  const rows = await prisma.billingDeckProduct.findMany({ where: { id: { in: ids } } })
  originalModes = rows.map((r) => ({
    id: r.id,
    pricingMode: r.pricingMode,
    paidActivatedAt: r.paidActivatedAt,
  }))
  await prisma.billingDeckProduct.updateMany({
    where: { id: { in: ids } },
    data: { pricingMode: 'SUBSCRIPTION', paidActivatedAt: new Date('2020-01-01T00:00:00Z') },
  })
}

async function restoreModes() {
  for (const m of originalModes) {
    await prisma.billingDeckProduct.update({
      where: { id: m.id },
      data: { pricingMode: m.pricingMode, paidActivatedAt: m.paidActivatedAt },
    })
  }
}

const d = RUN ? describe : describe.skip

d('구독 서비스 e2e (모킹 PG + 실 DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({ data: { id: SPACE_ID, name: 'e2e-billing' } })
    await setPaidMode(['coupang-ads', 'finance'])
  })

  afterAll(async () => {
    await restoreModes()
    await cleanup()
    await prisma.$disconnect()
  })

  beforeEach(() => {
    mockCharge.mockReset()
    mockIssue.mockReset()
  })

  it('Trial lazy-start는 평생 1회', async () => {
    await ensureTrialStarted(SPACE_ID)
    const sub1 = await prisma.spaceSubscription.findUnique({ where: { spaceId: SPACE_ID } })
    expect(sub1?.trialEndsAt).toBeTruthy()

    // Trial 만료로 조작 후 재시도 → 재부여 없음
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE_ID },
      data: { trialEndsAt: new Date('2020-01-15T00:00:00Z') },
    })
    await ensureTrialStarted(SPACE_ID)
    const sub2 = await prisma.spaceSubscription.findUnique({ where: { spaceId: SPACE_ID } })
    expect(sub2?.trialEndsAt).toEqual(new Date('2020-01-15T00:00:00Z'))
  })

  it('카드등록 → 구독시작(첫결제) → ACTIVE + entitlement 반영', async () => {
    mockIssue.mockResolvedValue({ billingKey: 'bk_test_123', cardSummary: '신한 ****1234' })
    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_1', failReason: null })

    const customerKey = await ensureCustomerKey(SPACE_ID)
    expect(customerKey).toBeTruthy()
    await registerBillingMethod(SPACE_ID, 'auth_key_test')

    const r = await startSubscription(SPACE_ID, ['coupang-ads', 'finance'])
    expect(r.amount).toBe(Math.round((29000 + 19000) * 1.1)) // VAT 포함 52,800

    const sub = await prisma.spaceSubscription.findUnique({
      where: { spaceId: SPACE_ID },
      include: { items: true },
    })
    expect(sub?.status).toBe('ACTIVE')
    expect(sub?.items.filter((i) => i.status === 'ACTIVE')).toHaveLength(2)

    const ent = await resolveEntitlement(SPACE_ID)
    expect(ent.decks['coupang-ads'].reason).toBe('SUBSCRIBED')
    expect(ent.decks['finance'].reason).toBe('SUBSCRIBED')

    // 빌링키는 암호화 저장 — 평문 노출 없음
    const method = await prisma.billingMethod.findFirst({ where: { spaceId: SPACE_ID } })
    expect(method?.billingKey).not.toBe('bk_test_123')
  })

  it('cron 멱등: 같은 주기 2회 실행 → 결제 1건', async () => {
    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_2', failReason: null })
    // 주기 도래로 조작
    const past = new Date(Date.now() - 3600_000)
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE_ID },
      data: { currentPeriodEnd: past },
    })

    const r1 = await runDueCharges()
    const r2 = await runDueCharges()
    expect(r1.find((x) => x.spaceId === SPACE_ID)?.outcome).toBe('paid')
    // 2회차: 주기 갱신됐으므로 대상 아님 (또는 already_processed)
    expect(r2.find((x) => x.spaceId === SPACE_ID)).toBeUndefined()
    expect(mockCharge).toHaveBeenCalledTimes(1)
  })

  it('deck 중도 추가 → 일할 즉시결제 + 즉시 활성', async () => {
    // finance 해제 후 재추가 시나리오 대신 seller-hub를 유료 전환해 추가
    await prisma.billingDeckProduct.update({
      where: { id: 'seller-hub' },
      data: { pricingMode: 'SUBSCRIPTION', paidActivatedAt: new Date('2020-01-01T00:00:00Z') },
    })
    originalModes.push({ id: 'seller-hub', pricingMode: 'FREE_BETA', paidActivatedAt: null })

    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_3', failReason: null })
    const r = await addDeck(SPACE_ID, 'seller-hub')
    expect(r.prorated).toBe(true)
    expect(r.amount).toBeGreaterThan(0)
    expect(r.amount).toBeLessThanOrEqual(Math.round(29000 * 1.1))

    const ent = await resolveEntitlement(SPACE_ID)
    expect(ent.decks['seller-hub'].reason).toBe('SUBSCRIBED')
  })

  it('해제 예약 → 주기말 결제에서 제외 + ENDED', async () => {
    await cancelDeck(SPACE_ID, 'seller-hub')
    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_4', failReason: null })
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE_ID },
      data: { currentPeriodEnd: new Date(Date.now() - 3600_000) },
    })
    const r = await runDueCharges()
    expect(r.find((x) => x.spaceId === SPACE_ID)?.outcome).toBe('paid')

    const lastCall = mockCharge.mock.calls.at(-1)![0]
    expect(lastCall.amount).toBe(Math.round((29000 + 19000) * 1.1)) // seller-hub 제외

    const item = await prisma.subscriptionItem.findFirst({
      where: { subscription: { spaceId: SPACE_ID }, deckAppId: 'seller-hub' },
    })
    expect(item?.status).toBe('ENDED')
  })

  it('dunning: 실패 누적 3회 → EXPIRED + 잠금', async () => {
    mockCharge.mockResolvedValue({ ok: false, paymentKey: null, failReason: '한도초과' })
    const base = Date.now() - 6 * 86400000 // 6일 전 결제일 — 모든 재시도 스케줄 경과
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE_ID },
      data: { currentPeriodEnd: new Date(base), retryCount: 0, status: 'ACTIVE' },
    })

    // 3회 시도 (FAILED 재사용 경로 — 매회 charge 시도)
    await runDueCharges()
    await runDueCharges()
    await runDueCharges()

    const sub = await prisma.spaceSubscription.findUnique({ where: { spaceId: SPACE_ID } })
    expect(sub?.status).toBe('EXPIRED')
    expect(mockCharge).toHaveBeenCalledTimes(3)

    const ent = await resolveEntitlement(SPACE_ID)
    expect(ent.decks['coupang-ads'].allowed).toBe(false)
    expect(ent.decks['coupang-ads'].reason).toBe('LOCKED')
    // FREE_BETA deck은 만료와 무관하게 정상
    expect(ent.decks['blog-ops'].reason).toBe('FREE_BETA')
  })
})
