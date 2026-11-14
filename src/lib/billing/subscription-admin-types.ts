import type { DeckAccessReason } from './entitlement-core'

export type SubscriptionAccessRow = {
  spaceId: string
  spaceName: string
  owners: { id: string; email: string; name: string | null }[]
  deckAppId: string
  deckName: string
  pricingMode: 'FREE_BETA' | 'SUBSCRIPTION'
  accessReason: DeckAccessReason
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  subscriptionStatus: string | null
  itemStatus: string | null
  /** 체험 중 구독 예약 — 아직 결제 전 */
  itemAwaitingTrialEnd: boolean
  spaceExempt: boolean
  exemptFlag: boolean
  exemptNote: string | null
  canExtendTrial: boolean
}

export type SubscriptionAccessOverview = {
  rows: SubscriptionAccessRow[]
  spaces: {
    id: string
    name: string
    owners: SubscriptionAccessRow['owners']
    exemptFlag: boolean
    exemptNote: string | null
  }[]
}
