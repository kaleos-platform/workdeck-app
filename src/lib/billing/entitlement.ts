// deck 단위 entitlement — DB 래퍼. 순수 판정 로직은 entitlement-core.ts.
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import {
  evaluateDeckAccess,
  TRIAL_DAYS,
  type DeckAccess,
  type SubscriptionInput,
} from './entitlement-core'

export * from './entitlement-core'

// 토스 계약 전 결제 일시 중지 스위치 — 결제 차단(assertCheckoutOpen)과 잠금 보류가 같은 판정을 쓴다
export function isCheckoutPaused(): boolean {
  return process.env.BILLING_CHECKOUT_PAUSED === '1'
}

// BILLING_CHECKOUT_ALLOW_SPACES(쉼표 구분 spaceId) 공간은 중지 중에도 결제가 열린 공간으로 본다 — 토스 심사용.
// 결제 차단과 잠금 보류가 같이 풀려야 업무 추가 → 구독 결제 흐름이 실제와 같다.
export function isCheckoutPausedFor(spaceId: string): boolean {
  if (!isCheckoutPaused()) return false
  const allowed = (process.env.BILLING_CHECKOUT_ALLOW_SPACES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return !allowed.includes(spaceId)
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
}

export interface SpaceEntitlement {
  allowedDecks: string[]
  lockedDecks: string[]
  // deck별 상세 (배너·UI용)
  decks: Record<string, DeckAccess & { trialEndsAt: Date | null; exempt: boolean }>
  trialEndsAt: Date | null
  exempt: boolean
}

// Space 전체 entitlement 조회 (DB 접근 래퍼)
export async function resolveEntitlement(
  spaceId: string,
  db: Prisma.TransactionClient = prisma
): Promise<SpaceEntitlement> {
  const now = new Date()
  const [products, subscription, instances, policies] = await Promise.all([
    db.billingDeckProduct.findMany({ where: { isActive: true } }),
    db.spaceSubscription.findUnique({
      where: { spaceId },
      include: {
        items: {
          where: { type: 'DECK', status: { in: ['ACTIVE', 'CANCEL_AT_PERIOD_END'] } },
          select: { deckAppId: true },
        },
      },
    }),
    db.deckInstance.findMany({
      where: { spaceId },
      select: { deckAppId: true, createdAt: true },
    }),
    db.spaceDeckAccess.findMany({ where: { spaceId } }),
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

  const policyMap = new Map(policies.map((p) => [p.deckAppId, p]))
  const instanceMap = new Map(instances.map((i) => [i.deckAppId, i.createdAt]))
  const decks: Record<string, DeckAccess & { trialEndsAt: Date | null; exempt: boolean }> = {}
  const allowedDecks: string[] = []
  const lockedDecks: string[] = []

  for (const product of products) {
    const access = evaluateDeckAccess({
      product,
      deckAccess: policyMap.get(product.id),
      subscription: subInput,
      deckInstanceCreatedAt: instanceMap.get(product.id) ?? null,
      now,
      checkoutPaused: isCheckoutPausedFor(spaceId),
    })
    decks[product.id] = {
      ...access,
      trialEndsAt: policyMap.get(product.id)?.trialEndsAt ?? null,
      exempt: Boolean(subscription?.exemptFlag || policyMap.get(product.id)?.exemptFlag),
    }
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

export async function canUseDeck(
  spaceId: string,
  deckAppId: string,
  db: Prisma.TransactionClient = prisma
): Promise<boolean> {
  const product = await db.billingDeckProduct.findUnique({ where: { id: deckAppId } })
  // 과금 카탈로그에 없는 deck(비활성 6종 등)은 billing 관할 밖 — 기존 동작 유지
  if (!product || !product.isActive) return true
  if (product.pricingMode === 'FREE_BETA') return true

  const entitlement = await resolveEntitlement(spaceId, db)
  return entitlement.decks[deckAppId]?.allowed ?? false
}

// deck mutation API 공통 가드 — readonly(만료) Space의 쓰기 차단, 조회는 통과.
// 각 deck의 mutation 라우트에 점진 적용한다. 반환: 차단 사유 문자열 | null(허용).
export async function assertDeckWritable(
  spaceId: string,
  deckAppId: string
): Promise<string | null> {
  if (await canUseDeck(spaceId, deckAppId)) return null
  return '구독이 만료되어 조회만 가능합니다'
}

// 워커 수집 게이트: coupang-ads 데이터는 Workspace 스코프지만 entitlement는 Space 축.
// Workspace.spaceId(명시 FK)의 Space로만 판정한다. FK가 비어 있으면 수집을 거부한다.
// 예전 역참조(ownerId → 역할과 무관한 최고참 멤버십)는 OWNER가 아닌 Space나 이미 다른 Workspace가
// 차지한 Space의 구독으로 수집 여부를 정하게 되므로 쓰지 않는다. 미연결 Workspace는 명시적 매핑이 필요하다.
export async function canWorkspaceCollect(workspaceId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { spaceId: true },
  })
  if (!workspace?.spaceId) return false
  return canUseDeck(workspace.spaceId, 'coupang-ads')
}

// 업무별 최초 활성화 시 7일. 비활성화·재추가·동시 요청도 기존 종료일을 덮어쓰지 않는다.
export async function ensureTrialStarted(
  spaceId: string,
  deckAppId: string,
  db: Prisma.TransactionClient = prisma
): Promise<void> {
  const [subscription, product, policy] = await Promise.all([
    db.spaceSubscription.findUnique({
      where: { spaceId },
      include: {
        items: {
          where: { type: 'DECK', deckAppId, status: { in: ['ACTIVE', 'CANCEL_AT_PERIOD_END'] } },
        },
      },
    }),
    db.billingDeckProduct.findUnique({ where: { id: deckAppId } }),
    db.spaceDeckAccess.findUnique({ where: { spaceId_deckAppId: { spaceId, deckAppId } } }),
  ])
  if (!product?.isActive || product.pricingMode !== 'SUBSCRIPTION') return
  if (subscription?.exemptFlag || policy?.exemptFlag || policy?.trialEndsAt) return
  if (
    subscription &&
    ['ACTIVE', 'PAST_DUE'].includes(subscription.status) &&
    subscription.items.length > 0
  )
    return
  const trialEndsAt = addDays(new Date(), TRIAL_DAYS)
  // 빈 upsert는 Prisma의 SELECT+INSERT로 처리될 수 있어 동시 요청에 안전한 ON CONFLICT를 사용한다.
  await db.spaceDeckAccess.createMany({
    data: [{ spaceId, deckAppId, trialEndsAt }],
    skipDuplicates: true,
  })
  // 면제만 관리하던 레코드에서 최초 체험을 시작하는 경우도 원자적으로 한 번만 설정한다.
  await db.spaceDeckAccess.updateMany({
    where: { spaceId, deckAppId, trialEndsAt: null, exemptFlag: false },
    data: { trialEndsAt },
  })
}
