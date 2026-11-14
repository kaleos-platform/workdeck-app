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
  spaceExempt: boolean
  exemptFlag: boolean
  exemptNote: string | null
  canExtendTrial: boolean
}

export type SubscriptionAccessOverview = {
  rows: SubscriptionAccessRow[]
  spaces: { id: string; name: string; exemptFlag: boolean; exemptNote: string | null }[]
}
