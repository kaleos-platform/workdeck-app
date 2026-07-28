// 구독 도메인 서비스 — 구독 시작/deck 추가·해제/정기결제/재시도.
// PG 호출은 providers/ 인터페이스 경유, entitlement 판정은 entitlement.ts가 담당.
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { encryptPii, decryptPii } from '@/lib/del/encryption'
import { getBillingProvider } from './providers/toss'
import {
  calcAmounts,
  sumLines,
  prorate,
  remainingDaysBetween,
  cycleOrderId,
  prorateOrderId,
  type ChargeLine,
} from './pricing'

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

function orderName(lines: ChargeLine[]): string {
  const first = lines[0]?.deckAppId ?? 'workdeck'
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

async function loadProducts(deckIds: string[]) {
  const products = await prisma.billingDeckProduct.findMany({
    where: { id: { in: deckIds }, isActive: true },
  })
  if (products.length !== deckIds.length) {
    throw new BillingError('과금 대상이 아닌 deck이 포함되어 있습니다', 400)
  }
  const paid = products.filter((p) => p.pricingMode === 'SUBSCRIPTION')
  if (paid.length !== products.length) {
    throw new BillingError('무료 베타 deck은 구독 대상이 아닙니다', 400)
  }
  return products
}

async function loadDefaultMethod(spaceId: string) {
  const method = await prisma.billingMethod.findFirst({
    where: { spaceId, isDefault: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!method) throw new BillingError('등록된 결제수단이 없습니다', 400)
  return { ...method, decryptedBillingKey: decryptPii(method.billingKey, method.billingKeyIv) }
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
  const encrypted = encryptPii(issued.billingKey)

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
export async function startSubscription(spaceId: string, deckIds: string[]) {
  if (deckIds.length === 0) throw new BillingError('구독할 deck을 선택하세요', 400)
  const products = await loadProducts(deckIds)
  const method = await loadDefaultMethod(spaceId)
  const provider = getBillingProvider()

  const subscription = await prisma.spaceSubscription.findUnique({
    where: { spaceId },
    include: { items: true },
  })
  if (!subscription) throw new BillingError('결제수단 등록이 선행되어야 합니다', 400)
  if (subscription.status === 'ACTIVE' || subscription.status === 'PAST_DUE') {
    throw new BillingError('이미 활성 구독이 있습니다 — deck 추가를 사용하세요', 409)
  }

  const now = new Date()
  const periodEnd = addMonthClamped(now)
  const lines: ChargeLine[] = products.map((p) => ({
    deckAppId: p.id,
    type: 'DECK',
    price: p.monthlyPrice,
  }))
  const amounts = sumLines(lines)
  const orderId = cycleOrderId(subscription.id, now)

  // 멱등 게이트: orderId 유니크 — 이미 청구 레코드가 있으면 중복 시작 시도
  const charge = await prisma.billingCharge
    .create({
      data: {
        spaceId,
        orderId,
        ...amounts,
        status: 'PENDING',
        provider: provider.id,
        periodStart: now,
        periodEnd,
        breakdown: lines as unknown as Prisma.InputJsonValue,
      },
    })
    .catch(() => null)
  if (!charge) throw new BillingError('이미 처리 중인 결제가 있습니다', 409)

  const result = await provider.charge({
    billingKey: method.decryptedBillingKey,
    customerKey: subscription.customerKey!,
    orderId,
    orderName: orderName(lines),
    amount: amounts.amount,
  })

  if (!result.ok) {
    await prisma.billingCharge.update({
      where: { id: charge.id },
      data: { status: 'FAILED', failReason: result.failReason },
    })
    throw new BillingError(`결제 실패: ${result.failReason}`, 402)
  }

  await prisma.$transaction([
    prisma.billingCharge.update({
      where: { id: charge.id },
      data: { status: 'PAID', paymentKey: result.paymentKey },
    }),
    prisma.spaceSubscription.update({
      where: { id: subscription.id },
      data: { status: 'ACTIVE', currentPeriodEnd: periodEnd, retryCount: 0 },
    }),
    // 이전 아이템(만료 재시작 케이스) 정리 후 이번 선택으로 upsert
    prisma.subscriptionItem.updateMany({
      where: { subscriptionId: subscription.id, status: { not: 'ENDED' } },
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
          priceSnapshot: p.monthlyPrice,
        },
        update: { status: 'ACTIVE', priceSnapshot: p.monthlyPrice, endedAt: null, addedAt: now },
      })
    ),
  ])

  return { periodEnd, amount: amounts.amount }
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
  if (existing?.status === 'ACTIVE') throw new BillingError('이미 구독 중인 deck입니다', 409)
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
  const supply = prorate(product.monthlyPrice, remaining, cycleDays)
  const amounts = calcAmounts(supply)

  // ENDED 이력이 있으면 재활성 (유니크 제약: subscriptionId+type+deckAppId)
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
      priceSnapshot: product.monthlyPrice,
      status: 'ACTIVE',
    },
    update: {
      status: 'ACTIVE',
      priceSnapshot: product.monthlyPrice,
      endedAt: null,
      addedAt: now,
    },
  })

  const orderId = prorateOrderId(item.id, now)
  const charge = await prisma.billingCharge.create({
    data: {
      spaceId,
      orderId,
      ...amounts,
      status: 'PENDING',
      provider: provider.id,
      periodStart: now,
      periodEnd: subscription.currentPeriodEnd,
      breakdown: [{ deckAppId, type: 'DECK', price: supply, prorated: true }],
    },
  })

  const result = await provider.charge({
    billingKey: method.decryptedBillingKey,
    customerKey: subscription.customerKey!,
    orderId,
    orderName: `워크덱 ${deckAppId} (일할)`,
    amount: amounts.amount,
  })

  if (!result.ok) {
    // 일할 결제 실패 → 아이템 롤백 (활성화 안 됨)
    await prisma.$transaction([
      prisma.billingCharge.update({
        where: { id: charge.id },
        data: { status: 'FAILED', failReason: result.failReason },
      }),
      prisma.subscriptionItem.update({
        where: { id: item.id },
        data: { status: 'ENDED', endedAt: now },
      }),
    ])
    throw new BillingError(`결제 실패: ${result.failReason}`, 402)
  }

  await prisma.billingCharge.update({
    where: { id: charge.id },
    data: { status: 'PAID', paymentKey: result.paymentKey },
  })

  return { prorated: true, amount: amounts.amount }
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
  if (!item) throw new BillingError('구독 중인 deck이 아닙니다', 404)

  await prisma.subscriptionItem.update({
    where: { id: item.id },
    data: { status: 'CANCEL_AT_PERIOD_END' },
  })
  return { effectiveAt: subscription.currentPeriodEnd }
}

// ── 정기결제 cron ──────────────────────────────────────────────

function shouldAttemptRetry(currentPeriodEnd: Date, retryCount: number, now: Date): boolean {
  if (retryCount >= MAX_RETRY) return false
  const offset = RETRY_OFFSETS_DAYS[retryCount]
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
      if (
        sub.status === 'PAST_DUE' &&
        !shouldAttemptRetry(sub.currentPeriodEnd!, sub.retryCount, now)
      ) {
        // 3회 소진 + 마지막 재시도일 경과 → EXPIRED
        if (
          sub.retryCount >= MAX_RETRY ||
          now.getTime() >
            sub.currentPeriodEnd!.getTime() + RETRY_OFFSETS_DAYS[MAX_RETRY - 1] * 86400000
        ) {
          if (sub.retryCount >= MAX_RETRY) {
            await prisma.spaceSubscription.update({
              where: { id: sub.id },
              data: { status: 'EXPIRED' },
            })
            results.push({ spaceId: sub.spaceId, outcome: 'expired' })
            continue
          }
        }
        results.push({ spaceId: sub.spaceId, outcome: 'waiting_retry' })
        continue
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
            data: { status: 'ENDED', endedAt: now },
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
        if (!existing || existing.status !== 'FAILED') {
          results.push({ spaceId: sub.spaceId, outcome: 'already_processed' })
          continue
        }
        // FAILED → 재시도: PENDING 선점 (경합 게이트 — 정확히 1회만 통과)
        const claimed = await prisma.billingCharge.updateMany({
          where: { id: existing.id, status: 'FAILED' },
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

      const result = await provider.charge({
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
            data: { status: 'ENDED', endedAt: now },
          }),
          prisma.spaceSubscription.update({
            where: { id: sub.id },
            data: { status: 'ACTIVE', currentPeriodEnd: periodEnd, retryCount: 0 },
          }),
        ])
        results.push({ spaceId: sub.spaceId, outcome: 'paid' })
      } else {
        const nextRetryCount = sub.retryCount + 1
        await prisma.$transaction([
          prisma.billingCharge.update({
            where: { id: charge.id },
            data: { status: 'FAILED', failReason: result.failReason },
          }),
          prisma.spaceSubscription.update({
            where: { id: sub.id },
            data: {
              status: nextRetryCount >= MAX_RETRY ? 'EXPIRED' : 'PAST_DUE',
              retryCount: nextRetryCount,
            },
          }),
        ])
        results.push({
          spaceId: sub.spaceId,
          outcome: nextRetryCount >= MAX_RETRY ? 'expired' : 'retry_scheduled',
        })
      }
    } catch (e) {
      // 구독 하나의 실패가 전체 cron을 죽이지 않도록 개별 격리
      results.push({ spaceId: sub.spaceId, outcome: `error: ${(e as Error).message}` })
    }
  }

  return results
}
