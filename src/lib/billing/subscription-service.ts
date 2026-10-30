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
  effectivePrice,
  type ChargeLine,
} from './pricing'
import { DECK_CATALOG_DEFAULTS } from './catalog-defaults'

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
async function createOrReclaimCharge(data: Prisma.BillingChargeUncheckedCreateInput) {
  const created = await prisma.billingCharge.create({ data }).catch((e) => {
    if ((e as { code?: string }).code === 'P2002') return null // orderId 중복만 흡수
    throw e
  })
  if (created) return created
  const existing = await prisma.billingCharge.findUnique({ where: { orderId: data.orderId } })
  if (existing?.status !== 'FAILED') return null
  const claimed = await prisma.billingCharge.updateMany({
    where: { id: existing.id, status: 'FAILED', updatedAt: existing.updatedAt },
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
  return claimed.count === 1
    ? prisma.billingCharge.findUnique({ where: { id: existing.id } })
    : null
}

async function loadProducts(deckIds: string[]) {
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
  const hasBillableItem =
    subscription &&
    !subscription.exemptFlag &&
    (subscription.status === 'ACTIVE' || subscription.status === 'PAST_DUE') &&
    subscription.items.some((item) => item.status === 'ACTIVE')
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

export async function startSubscription(spaceId: string, deckIds: string[]) {
  if (deckIds.length === 0) throw new BillingError('구독할 업무를 선택하세요', 400)
  const products = await loadProducts(deckIds)
  const method = await loadDefaultMethod(spaceId)
  const provider = getBillingProvider()

  const subscription = await prisma.spaceSubscription.findUnique({
    where: { spaceId },
    include: { items: true },
  })
  if (!subscription) throw new BillingError('결제수단 등록이 선행되어야 합니다', 400)
  if (subscription.status === 'ACTIVE' || subscription.status === 'PAST_DUE') {
    throw new BillingError('이미 활성 구독이 있습니다 — 업무 추가를 사용하세요', 409)
  }

  // 이전 고객 보장가: item 에 lockedPrice 가 있으면 사용 (정가가 더 낮아지면 정가)
  const priceOf = (p: { id: string; monthlyPrice: number }) =>
    effectivePrice(
      subscription.items.find((i) => i.type === 'DECK' && i.deckAppId === p.id)?.lockedPrice,
      p.monthlyPrice
    )

  const now = new Date()
  const periodEnd = addMonthClamped(now)
  const lines: ChargeLine[] = products.map((p) => ({
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
    // 이전 아이템(만료 재시작 케이스) 정리 후 이번 선택으로 upsert.
    // 재시작에서 고르지 않은 업무는 해지로 보고 보장가도 소멸
    prisma.subscriptionItem.updateMany({
      where: {
        subscriptionId: subscription.id,
        status: { not: 'ENDED' },
        deckAppId: { notIn: deckIds },
      },
      data: { status: 'ENDED', endedAt: now, lockedPrice: null },
    }),
    prisma.subscriptionItem.updateMany({
      where: {
        subscriptionId: subscription.id,
        status: { not: 'ENDED' },
        deckAppId: { in: deckIds },
      },
      data: { status: 'ENDED', endedAt: now },
    }),
    ...products.map((p) =>
      prisma.subscriptionItem.upsert({
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
        },
        update: { status: 'ACTIVE', priceSnapshot: priceOf(p), endedAt: null, addedAt: now },
      })
    ),
  ])

  return { periodEnd, amount: charge.amount }
}

// deck 중도 추가: 일할 즉시결제 → 즉시 활성
export async function addDeck(spaceId: string, deckAppId: string) {
  const [product] = await loadProducts([deckAppId])
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
    await prisma.subscriptionItem.update({
      where: { id: existing.id },
      data: { status: 'ACTIVE' },
    })
    return { prorated: false, amount: 0 }
  }

  const now = new Date()
  // 주기 일수 = periodEnd - (periodEnd - 1개월), 실제 달력 기준
  const prevPeriodStart = new Date(subscription.currentPeriodEnd)
  prevPeriodStart.setUTCMonth(prevPeriodStart.getUTCMonth() - 1)
  const cycleDays = Math.max(
    1,
    Math.round((subscription.currentPeriodEnd.getTime() - prevPeriodStart.getTime()) / 86400000)
  )
  const remaining = remainingDaysBetween(now, subscription.currentPeriodEnd)
  // 이전 고객 보장가 (ENDED item 에 남아 있음). 정가가 더 낮아지면 정가
  const price = effectivePrice(
    subscription.items.find((i) => i.type === 'DECK' && i.deckAppId === deckAppId)?.lockedPrice,
    product.monthlyPrice
  )
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
      data: { status: 'ACTIVE', priceSnapshot: price, endedAt: null, addedAt: now },
    }),
  ])

  return { prorated: true, amount: charge.amount }
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

  await prisma.subscriptionItem.update({
    where: { id: item.id },
    data: { status: 'CANCEL_AT_PERIOD_END' },
  })
  return { effectiveAt: subscription.currentPeriodEnd }
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
    },
  })

  const results: Array<{ spaceId: string; outcome: string }> = []

  for (const sub of due) {
    try {
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

      // 해제 예약 아이템은 이번 주기부터 제외 + ENDED 처리
      const cancelIds = sub.items
        .filter((i) => i.status === 'CANCEL_AT_PERIOD_END')
        .map((i) => i.id)
      const activeItems = sub.items.filter((i) => i.status === 'ACTIVE')

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

      const lines: ChargeLine[] = activeItems.map((i) => ({
        deckAppId: i.deckAppId,
        type: 'DECK',
        price: i.priceSnapshot,
      }))
      const amounts = sumLines(lines)
      const periodStart = sub.currentPeriodEnd!
      const periodEnd = addMonthClamped(periodStart)
      const orderId = cycleOrderId(sub.id, periodStart)

      // 멱등+경합 게이트: orderId 유니크 제약. 같은 주기 재실행 시 P2002 → 스킵.
      // 단 직전 시도가 FAILED면 재시도 가능해야 하므로 FAILED 레코드는 재사용.
      let charge = await prisma.billingCharge
        .create({
          data: {
            spaceId: sub.spaceId,
            orderId,
            ...amounts,
            status: 'PENDING',
            provider: provider.id,
            periodStart,
            periodEnd,
            breakdown: lines as unknown as Prisma.InputJsonValue,
          },
        })
        .catch(() => null)
      if (!charge) {
        const existing = await prisma.billingCharge.findUnique({ where: { orderId } })
        const stalePending =
          existing?.status === 'PENDING' &&
          existing.updatedAt.getTime() < now.getTime() - 60 * 60 * 1000
        if (!existing || (existing.status !== 'FAILED' && !stalePending)) {
          results.push({ spaceId: sub.spaceId, outcome: 'already_processed' })
          continue
        }
        // FAILED(또는 1시간+ 잔류 PENDING — 크래시 잔재) → 재시도 선점 (경합 게이트 — 정확히 1회만 통과)
        const claimed = await prisma.billingCharge.updateMany({
          where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt },
          data: {
            status: 'PENDING',
            ...amounts,
            breakdown: lines as unknown as Prisma.InputJsonValue,
          },
        })
        if (claimed.count !== 1) {
          results.push({ spaceId: sub.spaceId, outcome: 'already_processed' })
          continue
        }
        charge = await prisma.billingCharge.findUnique({ where: { id: existing.id } })
        if (!charge) continue
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
