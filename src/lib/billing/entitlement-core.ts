// deck 단위 entitlement 판정 순수 로직 — DB 무접근 (유닛 테스트 대상).
// 판정 순서: FREE_BETA → 면제 → 구독 아이템 → Trial → 유료 전환 유예 → 잠금.

export const TRIAL_DAYS = 14
export const GRACE_DAYS = 14

export type DeckAccessReason = 'FREE_BETA' | 'EXEMPT' | 'SUBSCRIBED' | 'TRIAL' | 'GRACE' | 'LOCKED'

export interface DeckProductInput {
  id: string
  pricingMode: 'FREE_BETA' | 'SUBSCRIPTION'
  paidActivatedAt: Date | null
  isActive: boolean
}

export interface SubscriptionInput {
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
  exemptFlag: boolean
  // ACTIVE | CANCEL_AT_PERIOD_END 상태의 DECK 아이템 deckAppId 목록
  activeDeckItemIds: string[]
}

export interface DeckAccessInput {
  product: DeckProductInput
  subscription: SubscriptionInput | null
  // 해당 Space의 DeckInstance 생성 시각 (없으면 null) — 유예 판정용
  deckInstanceCreatedAt: Date | null
  now: Date
}

export interface DeckAccess {
  allowed: boolean
  reason: DeckAccessReason
  // GRACE일 때 잠금 예정 시각 (배너 표시용)
  graceEndsAt?: Date
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
}

// 순수 판정 함수 — DB 무접근, 유닛 테스트 대상.
export function evaluateDeckAccess(input: DeckAccessInput): DeckAccess {
  const { product, subscription, deckInstanceCreatedAt, now } = input

  // 1. 무료 베타 deck은 전원 허용
  if (product.pricingMode === 'FREE_BETA') {
    return { allowed: true, reason: 'FREE_BETA' }
  }

  // 2. 운영자 면제
  if (subscription?.exemptFlag) {
    return { allowed: true, reason: 'EXEMPT' }
  }

  // 3. 구독 아이템 보유 (ACTIVE·PAST_DUE 구독만 유효 — dunning 중엔 full 유지)
  if (
    subscription &&
    (subscription.status === 'ACTIVE' || subscription.status === 'PAST_DUE') &&
    subscription.activeDeckItemIds.includes(product.id)
  ) {
    return { allowed: true, reason: 'SUBSCRIBED' }
  }

  // 4. Trial 유효
  if (subscription?.trialEndsAt && subscription.trialEndsAt > now) {
    return { allowed: true, reason: 'TRIAL' }
  }

  // 5. 유료 전환 유예: 전환 전부터 쓰던 Space는 paidActivatedAt+14일까지 허용
  if (
    product.paidActivatedAt &&
    deckInstanceCreatedAt &&
    deckInstanceCreatedAt < product.paidActivatedAt
  ) {
    const graceEndsAt = addDays(product.paidActivatedAt, GRACE_DAYS)
    if (now < graceEndsAt) {
      return { allowed: true, reason: 'GRACE', graceEndsAt }
    }
  }

  // 6. 잠금 (해당 deck만 — 다른 deck 무영향)
  return { allowed: false, reason: 'LOCKED' }
}
