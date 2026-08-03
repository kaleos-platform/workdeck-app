import type { DeckLandingContent, MarketingDeckSlug } from '../types'
import { coupangAdsLanding } from './coupang-ads'
import { sellerHubLanding } from './seller-hub'
import { salesContentLanding } from './sales-content'
import { financeLanding } from './finance'
import { recruitingLanding } from './recruiting'
import { blogOpsLanding } from './blog-ops'

export const DECK_LANDINGS: Record<MarketingDeckSlug, DeckLandingContent> = {
  'coupang-ads': coupangAdsLanding,
  'seller-hub': sellerHubLanding,
  'sales-content': salesContentLanding,
  finance: financeLanding,
  recruiting: recruitingLanding,
  'blog-ops': blogOpsLanding,
}
