// 구독 도메인 서비스 — 구독 시작/deck 추가·해제/정기결제/재시도.
// PG 호출은 providers/ 인터페이스 경유, entitlement 판정은 entitlement.ts가 담당.
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { decryptField, encryptField } from '@/lib/crypto/field-crypto'
import { upgradeIfLegacy } from '@/lib/crypto/reencrypt'
import { getBillingProvider } from './providers/toss'
import {
  calcAmounts,
  sumLines,
  prorate,
  remainingDaysBetween,
  cycleOrderId,
  startOrderId,
  prorateOrderId,
  trialStartOrderId,
  effectivePrice,
  type ChargeLine,
} from './pricing'
import { DECK_CATALOG_DEFAULTS } from './catalog-defaults'
import { isCheckoutPausedFor } from './entitlement'
import { findClosedDecks } from './deck-release'
import {
  hasPaidItems,
  loadTrialEnds,
  realignReservationOnly,
  reservedStart,
  type DbClient,
} from './trial-reservation'

// dunning: 결제일 경과 +1·+3·+5일에 재시도, 3회 실패 시 EXPIRED
const RETRY_OFFSETS_DAYS = [1, 3, 5]
export const MAX_RETRY = RETRY_OFFSETS_DAYS.length

function addMonthClamped(base: Date): Date {
  const d = new Date(base)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + 1)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return d
}

// 카드 명세서·결제 내역에 찍히는 이름 — deck id(slug)가 아니라 판매 상품명을 쓴다.
// 마케팅 상품 페이지의 상품명과 같아야 이용자가 결제 내역을 대조할 수 있다.
function deckLabel(deckAppId: string): string {
  return DECK_CATALOG_DEFAULTS.find((d) => d.id === deckAppId)?.name ?? deckAppId
}

function orderName(lines: ChargeLine[]): string {
  const first = deckLabel(lines[0]?.deckAppId ?? 'workdeck')
  return lines.length > 1 ? `워크덱 ${first} 외 ${lines.length - 1}건` : `워크덱 ${first}`
}

class BillingError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}
export { BillingError }

// 토스 계약 전(운영=테스트 키) 공백기: 실출금 없는 구독이 생기지 않게 새 결제·카드 등록을 막는다.
// 정기청구(cron)와 해제 예약 취소는 영향 없음. 중지 중엔 잠금도 보류된다(entitlement-core PAUSED).
// 계약 후 billing-admin trial-all 로 체험 공간에 기간을 준 뒤 BILLING_CHECKOUT_PAUSED 환경변수를 지운다.
// BILLING_CHECKOUT_ALLOW_SPACES(쉼표 구분 spaceId)는 중지 중에도 결제를 연다 — 토스 심사 담당자의 결제창 확인용.
export function assertCheckoutOpen(spaceId: string) {
  if (isCheckoutPausedFor(spaceId)) {
    throw new BillingError('결제 준비 중입니다. 결제가 열리면 이메일로 안내드립니다', 503)
  }
}

// provider.charge()가 예외를 던져도(네트워크·타임아웃·env 오류) 실패 결과로 정규화한다.
// 예외가 새어나가면 PENDING 청구·ACTIVE 아이템이 롤백 없이 남아
// "결제 없이 접근 허용" 또는 "재시도 영구 차단" 상태가 된다 (Codex P1 2건).
async function safeCharge(
  provider: ReturnType<typeof getBillingProvider>,
  params: Parameters<ReturnType<typeof getBillingProvider>['charge']>[0]
) {
  try {
    return await provider.charge(params)
  } catch (e) {
    // 예외 = 승인 여부 불명 (응답 유실·타임아웃). 거절로 단정하면 이중 결제가 난다 → unknown
    return {
      ok: false as const,
      paymentKey: null,
      failReason: (e as Error).message,
      unknown: true as const,
    }
  }
}

type SettleOutcome =
  | { kind: 'paid'; paymentKey: string | null }
  | { kind: 'failed'; reason: string }
  | { kind: 'pending' }

// 주문 조회로 결제를 확정한다. DONE = 승인, 그 밖의 상태·내역 없음 = 미승인, 조회 실패 = null(불명)
async function lookupOrder(
  provider: ReturnType<typeof getBillingProvider>,
  orderId: string
): Promise<{ paymentKey: string | null } | { failed: string } | null> {
  try {
    const found = await provider.fetchPaymentByOrderId(orderId)
    if (!found) return { failed: '결제 내역 없음' }
    return found.status === 'DONE' ? { paymentKey: found.paymentKey } : { failed: found.status }
  } catch {
    return null
  }
}

// 승인 요청 + 결과 확정. 거절은 즉시 failed, 결과 불명(예외·5xx·중복 주문 오류)은 주문 조회로 확정하고
// 조회도 실패하면 pending(청구 PENDING 유지 — 새 orderId 로 재청구하지 않는다).
async function settleCharge(
  provider: ReturnType<typeof getBillingProvider>,
  params: Parameters<ReturnType<typeof getBillingProvider>['charge']>[0]
): Promise<SettleOutcome> {
  const result = await safeCharge(provider, params)
  if (result.ok) return { kind: 'paid', paymentKey: result.paymentKey }
  if (!result.unknown) return { kind: 'failed', reason: result.failReason ?? '결제 실패' }
  const found = await lookupOrder(provider, params.orderId)
  if (!found) return { kind: 'pending' }
  if ('failed' in found) return { kind: 'failed', reason: result.failReason ?? found.failed }
  return { kind: 'paid', paymentKey: found.paymentKey }
}

const CHECKING_MESSAGE = '이전 결제 결과를 확인 중입니다 — 잠시 후 다시 시도하세요'
// 요청 한 건은 maxDuration(90초) 안에 끝난다 → 그보다 오래 PENDING 이면 요청이 죽은 것
const STALE_PENDING_MS = 5 * 60 * 1000

// 시작·일할추가 청구 중 PENDING 이 남아 있으면 새 결제를 막는다 (날짜별 orderId 가 달라도 이중 결제 방지).
// 5분 이내면 진행 중으로 보고 409, 그보다 오래됐으면 주문 조회로 확정한다.
// opPrefix 와 같은 작업의 승인 건이면 새로 청구하지 않고 그 청구를 이어받아 반환한다.
async function reconcilePending(
  provider: ReturnType<typeof getBillingProvider>,
  spaceId: string,
  opPrefix: string
) {
  const pendings = await prisma.billingCharge.findMany({
    where: {
      spaceId,
      status: 'PENDING',
      OR: [{ orderId: { startsWith: 'substart_' } }, { orderId: { startsWith: 'prorate_' } }],
    },
  })
  let adopted: { charge: (typeof pendings)[number]; paymentKey: string | null } | null = null
  for (const p of pendings) {
    if (Date.now() - p.updatedAt.getTime() < STALE_PENDING_MS) {
      throw new BillingError(CHECKING_MESSAGE, 409)
    }
    const found = await lookupOrder(provider, p.orderId)
    if (!found) throw new BillingError(CHECKING_MESSAGE, 409)
    if ('failed' in found) {
      await prisma.billingCharge.updateMany({
        where: { id: p.id, status: 'PENDING' },
        data: { status: 'FAILED', failReason: `결제 미승인: ${found.failed}` },
      })
    } else if (p.orderId.startsWith(opPrefix)) {
      adopted = { charge: p, paymentKey: found.paymentKey }
    } else {
      // 다른 작업의 승인 건 — 이 요청이 활성화할 수 없으므로 PAID 로만 기록하고 운영 확인에 맡긴다
      await prisma.billingCharge.updateMany({
        where: { id: p.id, status: 'PENDING' },
        data: { status: 'PAID', paymentKey: found.paymentKey },
      })
      console.error(
        '[billing] 승인 확인된 PENDING 청구가 활성화되지 않음 — 운영 확인 필요',
        p.orderId
      )
    }
  }
  return adopted
}

// 멱등 게이트: orderId 유니크 제약. 같은 orderId 의 직전 시도가 FAILED 면 그 행을 재사용한다
// (토스는 승인된 orderId 만 재사용을 막는다 — 정기결제 재시도와 같은 방식. 새 orderId 로 재시도하면
// 응답 유실 후 실제로는 승인된 건과 이중 결제될 수 있다). PENDING·PAID 면 null → 호출부가 409.
async function createOrReclaimCharge(
  data: Prisma.BillingChargeUncheckedCreateInput,
  renewal = false,
  now = new Date()
) {
  return prisma.$transaction(async (tx) => {
    // 운영자 정책 변경과 같은 Space 행을 잠가 면제 확인~PENDING 생성 사이의 경합을 막는다.
    await tx.$queryRaw`SELECT id FROM "Space" WHERE id = ${data.spaceId} FOR UPDATE`
    const lines = data.breakdown as unknown as ChargeLine[]
    const deckIds = lines.map((line) => line.deckAppId)
    const [subscription, exempt] = await Promise.all([
      tx.spaceSubscription.findUnique({
        where: { spaceId: data.spaceId },
        include: { items: true },
      }),
      tx.spaceDeckAccess.findFirst({
        where: { spaceId: data.spaceId, deckAppId: { in: deckIds }, exemptFlag: true },
      }),
    ])
    if (subscription?.exemptFlag || exempt)
      throw new BillingError('결제 면제 중인 업무는 유료 구독할 수 없습니다', 409)
    if (
      renewal &&
      (!subscription ||
        !['ACTIVE', 'PAST_DUE'].includes(subscription.status) ||
        subscription.currentPeriodEnd?.getTime() !== new Date(data.periodStart).getTime() ||
        deckIds.some(
          (id) =>
            !subscription.items.some(
              (item) => item.deckAppId === id && item.type === 'DECK' && item.status === 'ACTIVE'
            )
        ))
    ) {
      throw new BillingError('구독 상태가 변경되었습니다. 다음 청구 실행에서 다시 확인합니다', 409)
    }
    // 환불로 구독이 끝난 뒤에는 이전에 읽은 주기로 일할 결제를 시작하지 않는다.
    if (
      data.orderId.startsWith('prorate_') &&
      (!subscription ||
        !['ACTIVE', 'PAST_DUE'].includes(subscription.status) ||
        subscription.currentPeriodEnd?.getTime() !== new Date(data.periodEnd).getTime())
    ) {
      throw new BillingError('구독 상태가 변경되었습니다. 새로고침 후 다시 확인하세요', 409)
    }
    // 체험 종료일 일할 청구는 예약이 아직 살아 있을 때만 만든다(예약 취소와 경합 방지).
    if (
      data.orderId.includes('_trial') &&
      !subscription?.items.some(
        (item) =>
          item.type === 'DECK' &&
          deckIds.includes(item.deckAppId) &&
          item.status === 'ACTIVE' &&
          item.awaitingTrialEnd
      )
    ) {
      throw new BillingError('구독 상태가 변경되었습니다. 다음 청구 실행에서 다시 확인합니다', 409)
    }
    const existing = await tx.billingCharge.findUnique({ where: { orderId: data.orderId } })
    if (!existing) return tx.billingCharge.create({ data })
    const stalePending =
      renewal &&
      existing.status === 'PENDING' &&
      existing.updatedAt.getTime() < now.getTime() - 60 * 60 * 1000
    if (existing.status !== 'FAILED' && !stalePending) return null
    // 승인 여부가 불명인 주문의 금액은 바꾸지 않는다. 같은 주문으로 재요청해 PG 멱등성을 유지한다.
    if (
      stalePending &&
      (existing.amount !== data.amount ||
        JSON.stringify(existing.breakdown) !== JSON.stringify(data.breakdown))
    ) {
      throw new BillingError(CHECKING_MESSAGE, 409)
    }
    return tx.billingCharge.update({
      where: { id: existing.id },
      data: {
        status: 'PENDING',
        failReason: null,
        supplyAmount: data.supplyAmount,
        vatAmount: data.vatAmount,
        amount: data.amount,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        breakdown: data.breakdown,
      },
    })
  })
}

async function loadProducts(spaceId: string, deckIds: string[]) {
  const [subscription, exempt] = await Promise.all([
    prisma.spaceSubscription.findUnique({ where: { spaceId }, select: { exemptFlag: true } }),
    prisma.spaceDeckAccess.findFirst({
      where: { spaceId, deckAppId: { in: deckIds }, exemptFlag: true },
      select: { id: true },
    }),
  ])
  if (subscription?.exemptFlag || exempt) {
    throw new BillingError('결제 면제 중인 업무는 유료 구독할 수 없습니다', 409)
  }
  // 준비중 업무는 신규 구독 불가 — 이미 설치·구독 중인 공간은 예외 (URL 직접 호출 우회 차단)
  if ((await findClosedDecks(spaceId, deckIds)).length > 0) {
    throw new BillingError('준비중인 업무는 구독할 수 없습니다', 403)
  }
  const products = await prisma.billingDeckProduct.findMany({
    where: { id: { in: deckIds }, isActive: true },
  })
  if (products.length !== deckIds.length) {
    throw new BillingError('과금 대상이 아닌 업무가 포함되어 있습니다', 400)
  }
  const paid = products.filter((p) => p.pricingMode === 'SUBSCRIPTION')
  if (paid.length !== products.length) {
    throw new BillingError('무료 베타 업무는 구독 대상이 아닙니다', 400)
  }
  return products
}

async function loadDefaultMethod(spaceId: string) {
  const method = await prisma.billingMethod.findFirst({
    where: { spaceId, isDefault: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!method) throw new BillingError('등록된 결제수단이 없습니다', 400)
  const decryptedBillingKey = decryptField('billing-key', method.billingKey, method.billingKeyIv)
  await upgradeIfLegacy(
    'billing-key',
    { encrypted: method.billingKey, iv: method.billingKeyIv },
    decryptedBillingKey,
    (next) =>
      prisma.billingMethod.updateMany({
        where: { id: method.id, billingKey: method.billingKey },
        data: { billingKey: next.encrypted, billingKeyIv: next.iv },
      })
  )
  return { ...method, decryptedBillingKey }
}

const DAY_MS = 24 * 60 * 60 * 1000

// 주기 일수 = periodEnd - (periodEnd - 1개월), 실제 달력 기준
function cycleDaysEndingAt(periodEnd: Date): number {
  const prevPeriodStart = new Date(periodEnd)
  prevPeriodStart.setUTCMonth(prevPeriodStart.getUTCMonth() - 1)
  return Math.max(1, Math.round((periodEnd.getTime() - prevPeriodStart.getTime()) / DAY_MS))
}

// SDK 호출 전 선행: 구독 레코드 + customerKey 확보 (SDK requestBillingAuth에 동일 키 사용 필수)
export async function ensureCustomerKey(spaceId: string): Promise<string> {
  const provider = getBillingProvider()
  const existing = await prisma.spaceSubscription.findUnique({ where: { spaceId } })
  if (existing?.customerKey) return existing.customerKey
  if (existing) {
    const updated = await prisma.spaceSubscription.update({
      where: { spaceId },
      data: { customerKey: randomUUID(), provider: provider.id },
    })
    return updated.customerKey!
  }
  const created = await prisma.spaceSubscription.create({
    data: { spaceId, status: 'TRIALING', provider: provider.id, customerKey: randomUUID() },
  })
  return created.customerKey!
}

// 카드 등록 콜백: authKey → 빌링키 발급·암호화 저장.
// customerKey는 ensureCustomerKey로 선발급된 값과 일치해야 한다 (콜백 라우트에서 검증).
export async function registerBillingMethod(spaceId: string, authKey: string) {
  const provider = getBillingProvider()

  const subscription = await prisma.spaceSubscription.findUnique({ where: { spaceId } })
  if (!subscription?.customerKey) {
    throw new BillingError('구매자 키가 없습니다 — 카드 등록을 처음부터 다시 시도하세요', 400)
  }

  const issued = await provider.issueBillingKey(authKey, subscription.customerKey)
  const encrypted = encryptField('billing-key', issued.billingKey)

  // 기존 기본 결제수단은 해제하고 새 카드를 기본으로
  await prisma.$transaction([
    prisma.billingMethod.updateMany({ where: { spaceId }, data: { isDefault: false } }),
    prisma.billingMethod.create({
      data: {
        spaceId,
        provider: provider.id,
        billingKey: encrypted.encrypted,
        billingKeyIv: encrypted.iv,
        cardSummary: issued.cardSummary,
        isDefault: true,
      },
    }),
  ])

  return { cardSummary: issued.cardSummary }
}

// 구독 시작(또는 만료 상태에서 재시작): deck 선택 → 첫 결제 즉시 승인 → ACTIVE
/**
 * 결제수단 삭제. 빌링키는 결제를 실행할 수 있는 자격증명이므로 DB 행만 지우지 않고
 * PG 쪽에서도 폐기한다. 구독이 살아 있는데 지우면 다음 정기결제가 실패해 의도치 않은
 * 해지로 이어지므로, 청구 대상이 남아 있으면 막고 먼저 해지하게 한다.
 */
export async function removeBillingMethod(spaceId: string, methodId: string | null) {
  const method = methodId
    ? await prisma.billingMethod.findFirst({ where: { id: methodId, spaceId } })
    : await prisma.billingMethod.findFirst({ where: { spaceId, isDefault: true } })
  if (!method) throw new BillingError('등록된 결제수단이 없습니다', 404)

  const subscription = await prisma.spaceSubscription.findUnique({
    where: { spaceId },
    include: { items: { where: { status: { in: ['ACTIVE', 'CANCEL_AT_PERIOD_END'] } } } },
  })
  const policies = await prisma.spaceDeckAccess.findMany({
    where: { spaceId, exemptFlag: true },
    select: { deckAppId: true },
  })
  const exemptDeckIds = new Set(policies.map((p) => p.deckAppId))
  const hasBillableItem =
    subscription &&
    !subscription.exemptFlag &&
    (subscription.status === 'ACTIVE' || subscription.status === 'PAST_DUE') &&
    subscription.items.some(
      (item) => item.status === 'ACTIVE' && !exemptDeckIds.has(item.deckAppId)
    )
  if (hasBillableItem) {
    throw new BillingError(
      '구독 중인 업무가 있어 결제수단을 삭제할 수 없습니다 — 먼저 구독을 해지하세요',
      409
    )
  }

  // PG 폐기가 실패해도 사용자에게는 삭제를 보장해야 하므로 DB 삭제는 진행한다.
  // (남은 빌링키는 결제 시도 자체가 없으므로 사용되지 않는다.)
  try {
    const billingKey = decryptField('billing-key', method.billingKey, method.billingKeyIv)
    await getBillingProvider().deleteBillingKey(billingKey)
  } catch (e) {
    // PG 오류 원문에는 빌링키가 섞일 수 있다 — 종류만 남긴다.
    console.error(
      '[billing] 빌링키 폐기 실패 — DB 행은 삭제한다',
      e instanceof Error ? e.name : typeof e
    )
  }

  await prisma.billingMethod.delete({ where: { id: method.id } })
}

export async function startSubscription(spaceId: string, requestedDeckIds: string[]) {
  assertCheckoutOpen(spaceId)
  if (requestedDeckIds.length === 0) throw new BillingError('구독할 업무를 선택하세요', 400)
  const requestedProducts = await loadProducts(spaceId, requestedDeckIds)
  const method = await loadDefaultMethod(spaceId)
  const provider = getBillingProvider()

  const subscription = await prisma.spaceSubscription.findUnique({
    where: { spaceId },
    include: { items: true },
  })
  if (!subscription) throw new BillingError('결제수단 등록이 선행되어야 합니다', 400)
  // 체험 예약만 있는(아직 결제 전) ACTIVE 구독은 첫 유료 업무가 생길 때 시작 규칙을 다시 탄다.
  if (
    subscription.status === 'PAST_DUE' ||
    (subscription.status === 'ACTIVE' && hasPaidItems(subscription.items))
  ) {
    throw new BillingError('이미 활성 구독이 있습니다 — 업무 추가를 사용하세요', 409)
  }
  // 예약 전용 구독에서는 기존 예약을 항상 포함한다 — 빠뜨리면 아래 정리 단계가 예약과 보장가를 지운다
  // (오래된 화면에서 /start 를 직접 호출해도 안전하도록 서버에서 합친다).
  const deckIds =
    subscription.status === 'ACTIVE'
      ? [
          ...new Set([
            ...subscription.items
              .filter((i) => i.type === 'DECK' && i.status !== 'ENDED')
              .map((i) => i.deckAppId),
            ...requestedDeckIds,
          ]),
        ]
      : requestedDeckIds
  const products =
    deckIds.length === requestedDeckIds.length
      ? requestedProducts
      : await loadProducts(spaceId, deckIds)

  // 이전 고객 보장가: item 에 lockedPrice 가 있으면 사용 (정가가 더 낮아지면 정가)
  const priceOf = (p: { id: string; monthlyPrice: number }) =>
    effectivePrice(
      subscription.items.find((i) => i.type === 'DECK' && i.deckAppId === p.id)?.lockedPrice,
      p.monthlyPrice
    )

  const now = new Date()
  // 체험 중 업무는 체험 종료일에 결제를 시작한다(서버의 체험 종료일만 신뢰).
  const trialEnds = await loadTrialEnds(prisma, spaceId)
  const reservedIds = new Set(
    deckIds.filter((id) => (trialEnds.get(id)?.getTime() ?? 0) > now.getTime())
  )
  const itemUpserts = (db: DbClient) =>
    products.map((p) =>
      db.subscriptionItem.upsert({
        where: {
          subscriptionId_type_deckAppId: {
            subscriptionId: subscription.id,
            type: 'DECK',
            deckAppId: p.id,
          },
        },
        create: {
          subscriptionId: subscription.id,
          type: 'DECK',
          deckAppId: p.id,
          priceSnapshot: priceOf(p),
          awaitingTrialEnd: reservedIds.has(p.id),
        },
        update: {
          status: 'ACTIVE',
          priceSnapshot: priceOf(p),
          endedAt: null,
          addedAt: now,
          awaitingTrialEnd: reservedIds.has(p.id),
          billingRetryCount: 0,
        },
      })
    )
  const endOthers = (db: DbClient) => [
    // 재시작에서 고르지 않은 업무는 해지로 보고 보장가도 소멸
    db.subscriptionItem.updateMany({
      where: {
        subscriptionId: subscription.id,
        status: { not: 'ENDED' },
        deckAppId: { notIn: deckIds },
      },
      data: { status: 'ENDED', endedAt: now, lockedPrice: null },
    }),
    db.subscriptionItem.updateMany({
      where: {
        subscriptionId: subscription.id,
        status: { not: 'ENDED' },
        deckAppId: { in: deckIds },
      },
      data: { status: 'ENDED', endedAt: now },
    }),
  ]

  const immediate = products.filter((p) => !reservedIds.has(p.id))
  if (immediate.length === 0) {
    // 전부 체험 중: 지금은 0원, 가장 빠른 체험 종료일이 첫 결제일(정기결제 cron 이 한 달치 결제)
    const anchor = new Date(Math.min(...deckIds.map((id) => trialEnds.get(id)!.getTime())))
    await prisma.$transaction(async (tx) => {
      const moved = await tx.spaceSubscription.updateMany({
        where: {
          id: subscription.id,
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
        },
        data: { status: 'ACTIVE', currentPeriodEnd: anchor, retryCount: 0 },
      })
      if (moved.count === 0)
        throw new BillingError('구독 상태가 변경되었습니다. 새로고침 후 다시 확인하세요', 409)
      for (const op of endOthers(tx)) await op
      for (const op of itemUpserts(tx)) await op
    })
    return { periodEnd: anchor, amount: 0, reserved: true }
  }

  const periodEnd = addMonthClamped(now)
  const lines: ChargeLine[] = immediate.map((p) => ({
    deckAppId: p.id,
    type: 'DECK',
    price: priceOf(p),
  }))
  const amounts = sumLines(lines)
  const orderId = startOrderId(subscription.id, now)

  // 결과 불명 PENDING 이 남아 있으면 먼저 확정한다 (승인됐으면 그 청구를 이어받아 활성화)
  const adopted = await reconcilePending(provider, spaceId, `substart_${subscription.id}_`)
  let charge
  let paymentKey: string | null
  if (adopted) {
    charge = adopted.charge
    paymentKey = adopted.paymentKey
  } else {
    // 멱등 게이트: 같은 날 PENDING·PAID 청구가 있으면 중복 시작 시도 (FAILED 는 재시도 허용)
    charge = await createOrReclaimCharge({
      spaceId,
      orderId,
      ...amounts,
      status: 'PENDING',
      provider: provider.id,
      periodStart: now,
      periodEnd,
      breakdown: lines as unknown as Prisma.InputJsonValue,
    })
    if (!charge) throw new BillingError('이미 처리 중인 결제가 있습니다', 409)

    const outcome = await settleCharge(provider, {
      billingKey: method.decryptedBillingKey,
      customerKey: subscription.customerKey!,
      orderId,
      orderName: orderName(lines),
      amount: amounts.amount,
    })
    if (outcome.kind === 'pending') throw new BillingError(CHECKING_MESSAGE, 409)
    if (outcome.kind === 'failed') {
      await prisma.billingCharge.update({
        where: { id: charge.id },
        data: { status: 'FAILED', failReason: outcome.reason },
      })
      throw new BillingError(`결제 실패: ${outcome.reason}`, 402)
    }
    paymentKey = outcome.paymentKey
  }

  await prisma.$transaction([
    prisma.billingCharge.update({
      where: { id: charge.id },
      data: { status: 'PAID', paymentKey },
    }),
    prisma.spaceSubscription.update({
      where: { id: subscription.id },
      data: { status: 'ACTIVE', currentPeriodEnd: periodEnd, retryCount: 0 },
    }),
    // 이전 아이템(만료 재시작 케이스) 정리 후 이번 선택으로 upsert. 체험 중 업무는 예약으로 남긴다.
    ...endOthers(prisma),
    ...itemUpserts(prisma),
  ])

  return { periodEnd, amount: charge.amount, reserved: false }
}

// deck 중도 추가: 일할 즉시결제 → 즉시 활성
export async function addDeck(spaceId: string, deckAppId: string) {
  const [product] = await loadProducts(spaceId, [deckAppId])
  const method = await loadDefaultMethod(spaceId)
  const provider = getBillingProvider()

  const subscription = await prisma.spaceSubscription.findUnique({
    where: { spaceId },
    include: { items: true },
  })
  if (!subscription || (subscription.status !== 'ACTIVE' && subscription.status !== 'PAST_DUE')) {
    throw new BillingError('활성 구독이 없습니다 — 구독 시작을 사용하세요', 400)
  }
  if (!subscription.currentPeriodEnd) throw new BillingError('구독 주기 정보가 없습니다', 500)

  const existing = subscription.items.find(
    (i) => i.type === 'DECK' && i.deckAppId === deckAppId && i.status !== 'ENDED'
  )
  if (existing?.status === 'ACTIVE') throw new BillingError('이미 구독 중인 업무입니다', 409)
  if (existing?.status === 'CANCEL_AT_PERIOD_END') {
    // 해제 예약 취소 = 재활성 (기간말까지 이미 결제된 상태라 추가 결제 없음)
    const resumed = await prisma.subscriptionItem.updateMany({
      where: { id: existing.id, status: 'CANCEL_AT_PERIOD_END' },
      data: { status: 'ACTIVE' },
    })
    if (resumed.count === 0)
      throw new BillingError('구독 상태가 변경되었습니다. 새로고침 후 다시 확인하세요', 409)
    return { prorated: false, amount: 0, reserved: false }
  }

  // 예약만 있는 구독(결제 전)에 업무를 더하면 일할 대신 구독 시작 규칙으로 결제일을 다시 잡는다.
  if (subscription.status === 'ACTIVE' && !hasPaidItems(subscription.items)) {
    const live = subscription.items
      .filter((i) => i.type === 'DECK' && i.status !== 'ENDED')
      .map((i) => i.deckAppId)
    const started = await startSubscription(spaceId, [...new Set([...live, deckAppId])])
    return { prorated: false, amount: started.amount, reserved: started.reserved }
  }

  assertCheckoutOpen(spaceId)
  const now = new Date()
  const cycleDays = cycleDaysEndingAt(subscription.currentPeriodEnd)
  const remaining = remainingDaysBetween(now, subscription.currentPeriodEnd)
  // 이전 고객 보장가 (ENDED item 에 남아 있음). 정가가 더 낮아지면 정가
  const price = effectivePrice(
    subscription.items.find((i) => i.type === 'DECK' && i.deckAppId === deckAppId)?.lockedPrice,
    product.monthlyPrice
  )
  // 체험 중 업무: 지금은 0원 예약, 체험 종료일에 그날~결제일 일할 결제(runReservedStarts)
  const trialEndsAt = (await loadTrialEnds(prisma, spaceId)).get(deckAppId)
  if (trialEndsAt && trialEndsAt > now) {
    await prisma.subscriptionItem.upsert({
      where: {
        subscriptionId_type_deckAppId: { subscriptionId: subscription.id, type: 'DECK', deckAppId },
      },
      create: {
        subscriptionId: subscription.id,
        type: 'DECK',
        deckAppId,
        priceSnapshot: price,
        awaitingTrialEnd: true,
      },
      update: {
        status: 'ACTIVE',
        priceSnapshot: price,
        endedAt: null,
        addedAt: now,
        awaitingTrialEnd: true,
        billingRetryCount: 0,
      },
    })
    return { prorated: false, amount: 0, reserved: true }
  }

  const supply = prorate(price, remaining, cycleDays)
  const amounts = calcAmounts(supply)

  // 결제 성공 전에는 ACTIVE 로 만들지 않는다 (실패·중복 요청이 결제 없는 활성 상태를 남기지 않도록).
  // orderId 에 item.id 가 필요해 없으면 ENDED 로 먼저 만들고, 있으면(ENDED 이력) 그대로 둔다.
  // 유니크 제약: subscriptionId+type+deckAppId. 보장가(lockedPrice)는 건드리지 않는다.
  const item = await prisma.subscriptionItem.upsert({
    where: {
      subscriptionId_type_deckAppId: {
        subscriptionId: subscription.id,
        type: 'DECK',
        deckAppId,
      },
    },
    create: {
      subscriptionId: subscription.id,
      type: 'DECK',
      deckAppId,
      priceSnapshot: price,
      status: 'ENDED',
      endedAt: now,
    },
    update: {},
  })

  const orderId = prorateOrderId(item.id, now)
  const adopted = await reconcilePending(provider, spaceId, `prorate_${item.id}_`)
  let charge
  let paymentKey: string | null
  if (adopted) {
    charge = adopted.charge
    paymentKey = adopted.paymentKey
  } else {
    charge = await createOrReclaimCharge({
      spaceId,
      orderId,
      ...amounts,
      status: 'PENDING',
      provider: provider.id,
      periodStart: now,
      periodEnd: subscription.currentPeriodEnd,
      breakdown: [{ deckAppId, type: 'DECK', price: supply, prorated: true }],
    })
    if (!charge) throw new BillingError('이미 처리 중인 결제가 있습니다', 409)

    const outcome = await settleCharge(provider, {
      billingKey: method.decryptedBillingKey,
      customerKey: subscription.customerKey!,
      orderId,
      orderName: `워크덱 ${deckLabel(deckAppId)} (일할)`,
      amount: amounts.amount,
    })
    if (outcome.kind === 'pending') throw new BillingError(CHECKING_MESSAGE, 409)
    if (outcome.kind === 'failed') {
      await prisma.billingCharge.update({
        where: { id: charge.id },
        data: { status: 'FAILED', failReason: outcome.reason },
      })
      throw new BillingError(`결제 실패: ${outcome.reason}`, 402)
    }
    paymentKey = outcome.paymentKey
  }

  await prisma.$transaction([
    prisma.billingCharge.update({
      where: { id: charge.id },
      data: { status: 'PAID', paymentKey },
    }),
    prisma.subscriptionItem.update({
      where: { id: item.id },
      data: {
        status: 'ACTIVE',
        priceSnapshot: price,
        endedAt: null,
        addedAt: now,
        awaitingTrialEnd: false,
        billingRetryCount: 0,
      },
    }),
  ])

  return { prorated: true, amount: charge.amount, reserved: false }
}

// deck 해제 예약: 기간말까지 사용, 다음 주기 미청구
export async function cancelDeck(spaceId: string, deckAppId: string) {
  const subscription = await prisma.spaceSubscription.findUnique({
    where: { spaceId },
    include: { items: true },
  })
  if (!subscription) throw new BillingError('구독이 없습니다', 404)
  const item = subscription.items.find(
    (i) => i.type === 'DECK' && i.deckAppId === deckAppId && i.status === 'ACTIVE'
  )
  if (!item) throw new BillingError('구독 중인 업무가 아닙니다', 404)
  if (item.awaitingTrialEnd) {
    const settled = await cancelReservation(spaceId, subscription.id, item)
    if (settled) return settled
  }

  const canceled = await prisma.subscriptionItem.updateMany({
    where: { id: item.id, status: 'ACTIVE' },
    data: { status: 'CANCEL_AT_PERIOD_END' },
  })
  if (canceled.count === 0)
    throw new BillingError('구독 상태가 변경되었습니다. 새로고침 후 다시 확인하세요', 409)
  return { effectiveAt: subscription.currentPeriodEnd, reservationCanceled: false }
}

// 결제 전 예약 취소. 0원 종료면 결과를 반환하고, 결제가 이미 승인돼 있었으면 null(기존 해지로 진행).
async function cancelReservation(
  spaceId: string,
  subscriptionId: string,
  item: { id: string; deckAppId: string; addedAt: Date }
) {
  const now = new Date()
  const start = reservedStart(item, await loadTrialEnds(prisma, spaceId))
  if (start <= now) {
    // 체험이 끝나 결제가 시도됐을 수 있다 — 결과를 확인한 뒤에만 0원 취소한다.
    const cyclePending = await prisma.billingCharge.findFirst({
      where: { spaceId, status: 'PENDING', orderId: { startsWith: `sub_${subscriptionId}_` } },
    })
    if (cyclePending) throw new BillingError(CHECKING_MESSAGE, 409)
    const adopted = await reconcilePending(
      getBillingProvider(),
      spaceId,
      `prorate_${item.id}_trial`
    )
    if (adopted) {
      await prisma.$transaction([
        prisma.billingCharge.update({
          where: { id: adopted.charge.id },
          data: { status: 'PAID', paymentKey: adopted.paymentKey },
        }),
        prisma.subscriptionItem.update({
          where: { id: item.id },
          data: { awaitingTrialEnd: false, billingRetryCount: 0 },
        }),
      ])
      return null
    }
  }
  const outcome = await prisma.$transaction(async (tx) => {
    // cron 의 청구 생성(createOrReclaimCharge)과 같은 Space 행 잠금 아래에서 판단한다.
    await tx.$queryRaw`SELECT id FROM "Space" WHERE id = ${spaceId} FOR UPDATE`
    const charges = await tx.billingCharge.findMany({
      where: {
        spaceId,
        status: { in: ['PENDING', 'PAID'] },
        OR: [
          { orderId: { startsWith: `prorate_${item.id}_trial` } },
          { orderId: { startsWith: `sub_${subscriptionId}_` }, status: 'PENDING' },
        ],
      },
      select: { status: true, orderId: true },
    })
    if (charges.some((c) => c.status === 'PENDING')) throw new BillingError(CHECKING_MESSAGE, 409)
    if (charges.some((c) => c.status === 'PAID')) {
      // 이미 승인된 일할 결제가 있다 — 결제된 아이템으로 확정하고 일반 해지로 진행한다.
      await tx.subscriptionItem.updateMany({
        where: { id: item.id, status: 'ACTIVE', awaitingTrialEnd: true },
        data: { awaitingTrialEnd: false, billingRetryCount: 0 },
      })
      return 'paid' as const
    }
    // 결제 이력이 없으므로 해지가 아니다 — 보장가(lockedPrice)는 유지한다.
    const ended = await tx.subscriptionItem.updateMany({
      where: { id: item.id, status: 'ACTIVE', awaitingTrialEnd: true },
      data: { status: 'ENDED', endedAt: now },
    })
    if (ended.count === 0)
      throw new BillingError('구독 상태가 변경되었습니다. 새로고침 후 다시 확인하세요', 409)
    await realignReservationOnly(tx, subscriptionId, spaceId)
    return 'ended' as const
  })
  if (outcome === 'paid') return null
  return { effectiveAt: null, reservationCanceled: true }
}

// ── 정기결제 cron ──────────────────────────────────────────────

// retryCount = 지금까지 실패 횟수(초기 시도 포함). n번째 재시도는 결제일 + RETRY_OFFSETS_DAYS[n-1].
function shouldAttemptRetry(currentPeriodEnd: Date, retryCount: number, now: Date): boolean {
  if (retryCount < 1 || retryCount > MAX_RETRY) return false
  const offset = RETRY_OFFSETS_DAYS[retryCount - 1]
  return now.getTime() >= currentPeriodEnd.getTime() + offset * 86400000
}

// 매일 1회 실행. currentPeriodEnd 도래 구독 합산 결제 + dunning.
export async function runDueCharges(now = new Date()) {
  const provider = getBillingProvider()
  const due = await prisma.spaceSubscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'PAST_DUE'] },
      exemptFlag: false,
      currentPeriodEnd: { lte: now },
    },
    include: {
      items: { where: { type: 'DECK', status: { in: ['ACTIVE', 'CANCEL_AT_PERIOD_END'] } } },
      space: {
        select: {
          deckAccessPolicies: { where: { exemptFlag: true }, select: { deckAppId: true } },
        },
      },
    },
  })

  const results: Array<{ spaceId: string; outcome: string }> = []

  for (const sub of due) {
    try {
      // 해제 예약 아이템은 이번 주기부터 제외 + ENDED 처리
      const cancelIds = sub.items
        .filter((i) => i.status === 'CANCEL_AT_PERIOD_END')
        .map((i) => i.id)
      const allActive = sub.items.filter((i) => i.status === 'ACTIVE')
      // 체험 예약 분류(timestamp 정확 비교): 결제일보다 늦게 끝나는 체험은 이번 주기에서 제외·유지,
      // 결제일보다 먼저 끝났는데 아직 예약이면 일할 미납 → 새 주기 결제에 합산한다.
      const periodStartAt = sub.currentPeriodEnd!
      const trialEnds = await loadTrialEnds(prisma, sub.spaceId)
      const startOf = (i: (typeof allActive)[number]) => reservedStart(i, trialEnds)
      const futureItems = allActive.filter(
        (i) => i.awaitingTrialEnd && startOf(i).getTime() > periodStartAt.getTime()
      )
      const activeItems = allActive.filter((i) => !futureItems.includes(i))

      if (activeItems.length === 0 && futureItems.length > 0) {
        // 결제된 업무 없이 아직 체험 중인 예약만 남음(체험 연장 등) → 결제 없이 결제일을 다시 맞춘다.
        const next = new Date(Math.min(...futureItems.map((i) => startOf(i).getTime())))
        await prisma.$transaction([
          prisma.subscriptionItem.updateMany({
            where: { id: { in: cancelIds } },
            data: { status: 'ENDED', endedAt: now, lockedPrice: null }, // 실제 해지 → 보장가 소멸
          }),
          prisma.spaceSubscription.updateMany({
            where: { id: sub.id, currentPeriodEnd: sub.currentPeriodEnd },
            data: { status: 'ACTIVE', currentPeriodEnd: next, retryCount: 0 },
          }),
        ])
        results.push({ spaceId: sub.spaceId, outcome: 'reanchored' })
        continue
      }

      // 미납 일할의 단독 청구가 결과 불명이면 이중 청구를 피하려고 이 구독의 정기결제 전체를 보류한다.
      const debtItems = activeItems.filter(
        (i) => i.awaitingTrialEnd && startOf(i).getTime() < periodStartAt.getTime()
      )
      const settledDebt = new Set<string>()
      let hold = false
      for (const i of debtItems) {
        const debtOrderId = trialStartOrderId(i.id, startOf(i))
        const prior = await prisma.billingCharge.findUnique({ where: { orderId: debtOrderId } })
        if (prior?.status === 'PAID') {
          settledDebt.add(i.id)
        } else if (prior?.status === 'PENDING') {
          const found = await lookupOrder(provider, debtOrderId)
          if (!found) {
            hold = true
            break
          }
          if ('failed' in found) {
            await prisma.billingCharge.updateMany({
              where: { id: prior.id, status: 'PENDING' },
              data: { status: 'FAILED', failReason: `결제 미승인: ${found.failed}` },
            })
          } else {
            await prisma.billingCharge.updateMany({
              where: { id: prior.id, status: 'PENDING' },
              data: { status: 'PAID', paymentKey: found.paymentKey },
            })
            settledDebt.add(i.id)
          }
        }
      }
      if (hold) {
        results.push({ spaceId: sub.spaceId, outcome: 'waiting_pending_prorate' })
        continue
      }
      const dueIds = activeItems.map((i) => i.id)

      if (activeItems.length === 0) {
        // 남은 구독 deck 없음 → 주기 종료, CANCELED
        await prisma.$transaction([
          prisma.subscriptionItem.updateMany({
            where: { id: { in: cancelIds } },
            data: { status: 'ENDED', endedAt: now, lockedPrice: null }, // 실제 해지 → 보장가 소멸
          }),
          prisma.spaceSubscription.update({
            where: { id: sub.id },
            data: { status: 'CANCELED' },
          }),
        ])
        results.push({ spaceId: sub.spaceId, outcome: 'canceled' })
        continue
      }

      const exemptIds = new Set(sub.space.deckAccessPolicies.map((p) => p.deckAppId))
      const billableItems = activeItems.filter((item) => !exemptIds.has(item.deckAppId))
      if (billableItems.length === 0) {
        // 면제 주기는 미납으로 만들거나 PG에 0원을 청구하지 않는다. 밀린 주기도 소급 청구하지 않는다.
        let nextPeriod = addMonthClamped(sub.currentPeriodEnd!)
        while (nextPeriod <= now) nextPeriod = addMonthClamped(nextPeriod)
        await prisma.$transaction([
          prisma.subscriptionItem.updateMany({
            where: { id: { in: cancelIds } },
            data: { status: 'ENDED', endedAt: now, lockedPrice: null },
          }),
          prisma.subscriptionItem.updateMany({
            where: { id: { in: dueIds } },
            data: { awaitingTrialEnd: false, billingRetryCount: 0 },
          }),
          prisma.spaceSubscription.updateMany({
            where: { id: sub.id, currentPeriodEnd: sub.currentPeriodEnd },
            data: { status: 'ACTIVE', currentPeriodEnd: nextPeriod, retryCount: 0 },
          }),
        ])
        results.push({ spaceId: sub.spaceId, outcome: 'exempt' })
        continue
      }

      // PAST_DUE는 재시도 스케줄(+1·+3·+5일) 도래 시에만 시도
      if (sub.status === 'PAST_DUE') {
        if (sub.retryCount > MAX_RETRY) {
          // 초기 시도 + 재시도 3회 전부 실패 — 안전망 (실패 브랜치에서 이미 EXPIRED 처리됨)
          await prisma.spaceSubscription.update({
            where: { id: sub.id },
            data: { status: 'EXPIRED' },
          })
          results.push({ spaceId: sub.spaceId, outcome: 'expired' })
          continue
        }
        if (!shouldAttemptRetry(sub.currentPeriodEnd!, sub.retryCount, now)) {
          results.push({ spaceId: sub.spaceId, outcome: 'waiting_retry' })
          continue
        }
      }

      const lines: ChargeLine[] = billableItems.map((i) => ({
        deckAppId: i.deckAppId,
        type: 'DECK',
        price: i.priceSnapshot,
      }))
      // 미납 일할(체험 종료일~이번 결제일)을 별도 줄로 합산한다.
      const debtCycleDays = cycleDaysEndingAt(periodStartAt)
      for (const i of billableItems) {
        if (!debtItems.includes(i) || settledDebt.has(i.id)) continue
        lines.push({
          deckAppId: i.deckAppId,
          type: 'DECK',
          price: prorate(
            i.priceSnapshot,
            remainingDaysBetween(startOf(i), periodStartAt),
            debtCycleDays
          ),
          prorated: true,
        })
      }
      const amounts = sumLines(lines)
      const periodStart = sub.currentPeriodEnd!
      const periodEnd = addMonthClamped(periodStart)
      const orderId = cycleOrderId(sub.id, periodStart)

      const charge = await createOrReclaimCharge(
        {
          spaceId: sub.spaceId,
          orderId,
          ...amounts,
          status: 'PENDING',
          provider: provider.id,
          periodStart,
          periodEnd,
          breakdown: lines as unknown as Prisma.InputJsonValue,
        },
        true,
        now
      )
      if (!charge) {
        results.push({ spaceId: sub.spaceId, outcome: 'already_processed' })
        continue
      }

      const method = await loadDefaultMethod(sub.spaceId).catch(() => null)
      if (!method) {
        await prisma.$transaction([
          prisma.billingCharge.update({
            where: { id: charge.id },
            data: { status: 'FAILED', failReason: '결제수단 없음' },
          }),
          prisma.spaceSubscription.update({
            where: { id: sub.id },
            data: { status: 'PAST_DUE', retryCount: { increment: 1 } },
          }),
        ])
        results.push({ spaceId: sub.spaceId, outcome: 'failed_no_method' })
        continue
      }

      const result = await safeCharge(provider, {
        billingKey: method.decryptedBillingKey,
        customerKey: sub.customerKey!,
        orderId,
        orderName: orderName(lines),
        amount: amounts.amount,
      })

      if (result.ok) {
        await prisma.$transaction([
          prisma.billingCharge.update({
            where: { id: charge.id },
            data: { status: 'PAID', paymentKey: result.paymentKey },
          }),
          prisma.subscriptionItem.updateMany({
            where: { id: { in: cancelIds } },
            data: { status: 'ENDED', endedAt: now, lockedPrice: null }, // 실제 해지 → 보장가 소멸
          }),
          prisma.subscriptionItem.updateMany({
            where: { id: { in: dueIds } },
            data: { awaitingTrialEnd: false, billingRetryCount: 0 },
          }),
          prisma.spaceSubscription.update({
            where: { id: sub.id },
            data: { status: 'ACTIVE', currentPeriodEnd: periodEnd, retryCount: 0 },
          }),
        ])
        results.push({ spaceId: sub.spaceId, outcome: 'paid' })
      } else {
        const nextRetryCount = sub.retryCount + 1
        const exhausted = nextRetryCount > MAX_RETRY // 초기 시도 + 재시도 3회 전부 실패
        await prisma.$transaction([
          prisma.billingCharge.update({
            where: { id: charge.id },
            data: { status: 'FAILED', failReason: result.failReason },
          }),
          prisma.spaceSubscription.update({
            where: { id: sub.id },
            data: {
              status: exhausted ? 'EXPIRED' : 'PAST_DUE',
              retryCount: nextRetryCount,
            },
          }),
        ])
        results.push({
          spaceId: sub.spaceId,
          outcome: exhausted ? 'expired' : 'retry_scheduled',
        })
      }
    } catch (e) {
      // 구독 하나의 실패가 전체 cron을 죽이지 않도록 개별 격리
      results.push({ spaceId: sub.spaceId, outcome: `error: ${(e as Error).message}` })
    }
  }

  return results
}

// ── 체험 종료일 일할 결제 (cron: runDueCharges 보다 먼저 실행) ─────────────────
// 결제된 구독 중간에 체험이 끝난 예약 업무를 그날~다음 결제일까지 일할 결제한다.
// 실패는 그 업무만 재시도(구독 retryCount·PAST_DUE 미사용)하고, 소진되면 그 업무만 종료한다.
// 정기결제일이 먼저 오면 runDueCharges 가 미납분을 새 주기 결제에 합산한다.
export async function runReservedStarts(now = new Date()) {
  const provider = getBillingProvider()
  const subs = await prisma.spaceSubscription.findMany({
    where: {
      status: 'ACTIVE',
      exemptFlag: false,
      currentPeriodEnd: { gt: now },
      items: { some: { type: 'DECK', status: 'ACTIVE', awaitingTrialEnd: true } },
    },
    include: {
      items: { where: { type: 'DECK', status: 'ACTIVE', awaitingTrialEnd: true } },
      space: {
        select: {
          deckAccessPolicies: { where: { exemptFlag: true }, select: { deckAppId: true } },
        },
      },
    },
  })

  const results: Array<{ spaceId: string; itemId: string; outcome: string }> = []
  for (const sub of subs) {
    const periodEnd = sub.currentPeriodEnd!
    const trialEnds = await loadTrialEnds(prisma, sub.spaceId)
    const exemptIds = new Set(sub.space.deckAccessPolicies.map((p) => p.deckAppId))
    for (const item of sub.items) {
      const push = (outcome: string) =>
        results.push({ spaceId: sub.spaceId, itemId: item.id, outcome })
      try {
        const start = reservedStart(item, trialEnds)
        // 아직 체험 중이거나, 정기결제일과 같은 날 시작(한 달치는 runDueCharges 담당)
        if (start > now || start >= periodEnd) continue
        if (exemptIds.has(item.deckAppId)) {
          await prisma.subscriptionItem.updateMany({
            where: { id: item.id, awaitingTrialEnd: true },
            data: { awaitingTrialEnd: false, billingRetryCount: 0 },
          })
          push('exempt')
          continue
        }
        const n = item.billingRetryCount
        if (n >= 1 && now.getTime() < start.getTime() + RETRY_OFFSETS_DAYS[n - 1] * DAY_MS) {
          push('waiting_retry')
          continue
        }

        const supply = prorate(
          item.priceSnapshot,
          remainingDaysBetween(start, periodEnd),
          cycleDaysEndingAt(periodEnd)
        )
        const amounts = calcAmounts(supply)
        const orderId = trialStartOrderId(item.id, start)

        const prior = await prisma.billingCharge.findUnique({ where: { orderId } })
        let approvedKey: string | null | undefined
        if (prior?.status === 'PAID') approvedKey = prior.paymentKey
        if (prior?.status === 'PENDING') {
          if (now.getTime() - prior.updatedAt.getTime() < STALE_PENDING_MS) {
            push('pending')
            continue
          }
          const found = await lookupOrder(provider, orderId)
          if (!found) {
            push('pending')
            continue
          }
          if ('failed' in found) {
            await prisma.billingCharge.updateMany({
              where: { id: prior.id, status: 'PENDING' },
              data: { status: 'FAILED', failReason: `결제 미승인: ${found.failed}` },
            })
          } else {
            approvedKey = found.paymentKey
          }
        }

        let chargeId = prior?.id
        let failReason: string | null = null
        if (approvedKey === undefined) {
          const charge = await createOrReclaimCharge({
            spaceId: sub.spaceId,
            orderId,
            ...amounts,
            status: 'PENDING',
            provider: provider.id,
            periodStart: start,
            periodEnd,
            breakdown: [{ deckAppId: item.deckAppId, type: 'DECK', price: supply, prorated: true }],
          })
          if (!charge) {
            push('already_processed')
            continue
          }
          chargeId = charge.id
          const method = await loadDefaultMethod(sub.spaceId).catch(() => null)
          if (!method) {
            failReason = '결제수단 없음'
          } else {
            const outcome = await settleCharge(provider, {
              billingKey: method.decryptedBillingKey,
              customerKey: sub.customerKey!,
              orderId,
              orderName: `워크덱 ${deckLabel(item.deckAppId)} (체험 종료 후 일할)`,
              amount: amounts.amount,
            })
            if (outcome.kind === 'pending') {
              push('pending')
              continue
            }
            if (outcome.kind === 'failed') failReason = outcome.reason
            else approvedKey = outcome.paymentKey
          }
        }

        if (approvedKey !== undefined) {
          await prisma.$transaction([
            prisma.billingCharge.update({
              where: { id: chargeId! },
              data: { status: 'PAID', paymentKey: approvedKey },
            }),
            prisma.subscriptionItem.updateMany({
              where: { id: item.id, awaitingTrialEnd: true },
              data: { awaitingTrialEnd: false, billingRetryCount: 0 },
            }),
          ])
          push('paid')
          continue
        }

        const nextRetry = n + 1
        const exhausted = nextRetry > MAX_RETRY
        await prisma.$transaction(async (tx) => {
          await tx.billingCharge.update({
            where: { id: chargeId! },
            data: { status: 'FAILED', failReason },
          })
          // 결제 실패 만료는 보장가 유지(기존 정책) — lockedPrice 는 건드리지 않는다.
          await tx.subscriptionItem.updateMany({
            where: { id: item.id, status: 'ACTIVE', awaitingTrialEnd: true },
            data: exhausted
              ? { status: 'ENDED', endedAt: now, billingRetryCount: nextRetry }
              : { billingRetryCount: nextRetry },
          })
          if (exhausted) await realignReservationOnly(tx, sub.id, sub.spaceId)
        })
        push(exhausted ? 'ended' : 'retry_scheduled')
      } catch (e) {
        push(`error: ${(e as Error).message}`)
      }
    }
  }
  return results
}
