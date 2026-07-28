// deck 단위 entitlement — DB 래퍼. 순수 판정 로직은 entitlement-core.ts.
import { prisma } from '@/lib/prisma'
import {
  evaluateDeckAccess,
  TRIAL_DAYS,
  type DeckAccess,
  type SubscriptionInput,
} from './entitlement-core'

export * from './entitlement-core'

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
}

export interface SpaceEntitlement {
  allowedDecks: string[]
  lockedDecks: string[]
  // deck별 상세 (배너·UI용)
  decks: Record<string, DeckAccess>
  trialEndsAt: Date | null
  exempt: boolean
}

// Space 전체 entitlement 조회 (DB 접근 래퍼)
export async function resolveEntitlement(spaceId: string): Promise<SpaceEntitlement> {
  const now = new Date()
  const [products, subscription, instances] = await Promise.all([
    prisma.billingDeckProduct.findMany({ where: { isActive: true } }),
    prisma.spaceSubscription.findUnique({
      where: { spaceId },
      include: {
        items: {
          where: { type: 'DECK', status: { in: ['ACTIVE', 'CANCEL_AT_PERIOD_END'] } },
          select: { deckAppId: true },
        },
      },
    }),
    prisma.deckInstance.findMany({
      where: { spaceId },
      select: { deckAppId: true, createdAt: true },
    }),
  ])

  const subInput: SubscriptionInput | null = subscription
    ? {
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodEnd: subscription.currentPeriodEnd,
        exemptFlag: subscription.exemptFlag,
        activeDeckItemIds: subscription.items.map((i) => i.deckAppId),
      }
    : null

  const instanceMap = new Map(instances.map((i) => [i.deckAppId, i.createdAt]))
  const decks: Record<string, DeckAccess> = {}
  const allowedDecks: string[] = []
  const lockedDecks: string[] = []

  for (const product of products) {
    const access = evaluateDeckAccess({
      product,
      subscription: subInput,
      deckInstanceCreatedAt: instanceMap.get(product.id) ?? null,
      now,
    })
    decks[product.id] = access
    if (access.allowed) allowedDecks.push(product.id)
    else lockedDecks.push(product.id)
  }

  return {
    allowedDecks,
    lockedDecks,
    decks,
    trialEndsAt: subscription?.trialEndsAt ?? null,
    exempt: subscription?.exemptFlag ?? false,
  }
}

export async function canUseDeck(spaceId: string, deckAppId: string): Promise<boolean> {
  const product = await prisma.billingDeckProduct.findUnique({ where: { id: deckAppId } })
  // 과금 카탈로그에 없는 deck(비활성 6종 등)은 billing 관할 밖 — 기존 동작 유지
  if (!product || !product.isActive) return true
  if (product.pricingMode === 'FREE_BETA') return true

  const entitlement = await resolveEntitlement(spaceId)
  return entitlement.decks[deckAppId]?.allowed ?? false
}

// Trial lazy-start: 유료 deck 첫 사용 시도 시 호출.
// Trial 이력(trialEndsAt 존재)이 있으면 아무것도 하지 않는다 — 평생 1회.
export async function ensureTrialStarted(spaceId: string): Promise<void> {
  const now = new Date()
  const trialEndsAt = addDays(now, TRIAL_DAYS)
  const existing = await prisma.spaceSubscription.findUnique({ where: { spaceId } })
  if (!existing) {
    await prisma.spaceSubscription.create({
      data: { spaceId, status: 'TRIALING', trialEndsAt },
    })
    return
  }
  if (existing.trialEndsAt) return // 평생 1회
  // 구독 레코드는 있으나 Trial 이력 없음 (예: 면제 해제된 Space) — TRIALING 상태일 때만 부여
  if (existing.status === 'TRIALING') {
    await prisma.spaceSubscription.update({
      where: { spaceId },
      data: { trialEndsAt },
    })
  }
}
