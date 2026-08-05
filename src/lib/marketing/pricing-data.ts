import { DECK_CATALOG_DEFAULTS } from '@/lib/billing/catalog-defaults'
import { calcAmounts } from '@/lib/billing/pricing'
import { DECK_META } from '@/lib/deck-meta'
import { DECK_LANDINGS } from './decks'
import type { MarketingDeckSlug } from './types'

export interface DeckPricingRow {
  slug: MarketingDeckSlug
  name: string
  /** 공급가(VAT 별도) KRW */
  supplyPrice: number
  /** VAT 포함 결제 예정액 KRW */
  totalPrice: number
  summary: string
}

/**
 * 마케팅 pricing 페이지용 deck 가격 목록.
 * 값 자체는 DECK_CATALOG_DEFAULTS(=BillingDeckProduct 시드)에서 파생 —
 * 예정가를 두 곳에서 따로 관리하지 않는다. 현재 전 deck FREE_BETA(무료)이며
 * 여기 표시되는 금액은 정식 전환 시 예정가다.
 */
export const DECK_PRICING_ROWS: DeckPricingRow[] = DECK_CATALOG_DEFAULTS.map((deck) => {
  const slug = deck.id as MarketingDeckSlug
  const { amount } = calcAmounts(deck.monthlyPrice)
  return {
    slug,
    name: DECK_META[slug].name,
    supplyPrice: deck.monthlyPrice,
    totalPrice: amount,
    summary: DECK_LANDINGS[slug].hero.subcopy,
  }
})
