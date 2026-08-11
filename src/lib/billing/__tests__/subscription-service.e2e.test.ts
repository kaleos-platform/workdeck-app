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
    // 주기 도래로 조작 (오프셋은 테스트별 고유 — cycleOrderId가 초 단위라 같은 초면 충돌)
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
      data: { currentPeriodEnd: new Date(Date.now() - 7300_000) }, // 고유 오프셋 (orderId 충돌 방지)
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

    // 초기 시도 1회 + 재시도 3회(+1·+3·+5일 전부 경과) = 4회 실패 → EXPIRED
    await runDueCharges()
    await runDueCharges()
    await runDueCharges()
    await runDueCharges()

    const sub = await prisma.spaceSubscription.findUnique({ where: { spaceId: SPACE_ID } })
    expect(sub?.status).toBe('EXPIRED')
    expect(mockCharge).toHaveBeenCalledTimes(4)

    const ent = await resolveEntitlement(SPACE_ID)
    expect(ent.decks['coupang-ads'].allowed).toBe(false)
    expect(ent.decks['coupang-ads'].reason).toBe('LOCKED')
    // FREE_BETA deck은 만료와 무관하게 정상
    expect(ent.decks['sales-content'].reason).toBe('FREE_BETA')
  })

  it('dunning 첫 재시도는 +1일 (+3일 아님)', async () => {
    // 결제일 2일 전 경과, retryCount=1 (초기 실패 직후) → +1일 스케줄 도래 = 재시도 실행
    mockCharge.mockResolvedValue({ ok: false, paymentKey: null, failReason: '한도초과' })
    await prisma.billingCharge.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE_ID },
      data: {
        currentPeriodEnd: new Date(Date.now() - 2 * 86400000),
        retryCount: 1,
        status: 'PAST_DUE',
      },
    })
    const r = await runDueCharges()
    // 구버그: offset index=retryCount(1)→+3일 대기(waiting_retry). 수정 후: +1일 경과라 즉시 시도
    expect(r.find((x) => x.spaceId === SPACE_ID)?.outcome).toBe('retry_scheduled')
    expect(mockCharge).toHaveBeenCalledTimes(1)
  })

  it('provider 예외(throw) 시 deck 추가 롤백 — 결제 없이 활성화 금지', async () => {
    // 구독 복구 (이전 테스트에서 PAST_DUE/EXPIRED 상태)
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE_ID },
      data: {
        status: 'ACTIVE',
        retryCount: 0,
        currentPeriodEnd: new Date(Date.now() + 20 * 86400000),
      },
    })
    // seller-hub 아이템을 ENDED로 명시 (선행 테스트 결과 의존 제거) 후 재추가 시도
    await prisma.subscriptionItem.updateMany({
      where: { subscription: { spaceId: SPACE_ID }, deckAppId: 'seller-hub' },
      data: { status: 'ENDED', endedAt: new Date() },
    })
    mockCharge.mockRejectedValue(new Error('network timeout'))
    await expect(addDeck(SPACE_ID, 'seller-hub')).rejects.toThrow('결제 실패')

    const item = await prisma.subscriptionItem.findFirst({
      where: { subscription: { spaceId: SPACE_ID }, deckAppId: 'seller-hub' },
    })
    expect(item?.status).toBe('ENDED') // 롤백 확인

    const ent = await resolveEntitlement(SPACE_ID)
    expect(ent.decks['seller-hub'].allowed).toBe(false)

    const charge = await prisma.billingCharge.findFirst({
      where: { spaceId: SPACE_ID, orderId: { startsWith: 'prorate_' } },
      orderBy: { createdAt: 'desc' },
    })
    expect(charge?.status).toBe('FAILED') // PENDING 잔류 없음
  })

  it('정기결제 provider 예외 시 PENDING 미잔류 — 다음 cron이 재시도', async () => {
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE_ID },
      data: { currentPeriodEnd: new Date(Date.now() - 10800_000), retryCount: 0, status: 'ACTIVE' },
    })
    mockCharge.mockRejectedValueOnce(new Error('ETIMEDOUT'))
    const r1 = await runDueCharges()
    expect(r1.find((x) => x.spaceId === SPACE_ID)?.outcome).toBe('retry_scheduled')

    // 청구가 FAILED로 마감돼야 다음 재시도가 재사용 가능 (구버그: PENDING 잔류→already_processed 영구)
    const charge = await prisma.billingCharge.findFirst({
      where: { spaceId: SPACE_ID, orderId: { startsWith: 'sub_' } },
      orderBy: { createdAt: 'desc' },
    })
    expect(charge?.status).toBe('FAILED')

    // +1일 경과 시뮬레이션 → 성공 재시도가 같은 orderId 재사용
    await prisma.spaceSubscription.update({
      where: { spaceId: SPACE_ID },
      data: { currentPeriodEnd: new Date(Date.now() - 2 * 86400000), retryCount: 1 },
    })
    // periodStart 바뀌면 orderId도 바뀌므로 기존 FAILED 정리 후 성공 경로 확인
    mockCharge.mockResolvedValue({ ok: true, paymentKey: 'pay_recover', failReason: null })
    const r2 = await runDueCharges()
    expect(r2.find((x) => x.spaceId === SPACE_ID)?.outcome).toBe('paid')

    const sub = await prisma.spaceSubscription.findUnique({ where: { spaceId: SPACE_ID } })
    expect(sub?.status).toBe('ACTIVE')
    expect(sub?.retryCount).toBe(0)
  })
})
