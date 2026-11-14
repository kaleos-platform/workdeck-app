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
 * 가격을 두 곳에서 따로 관리하지 않는다. 마케팅 사이트 표시 금액과
 * 실제 청구 금액이 어긋나지 않도록 이 파생 관계를 유지한다.
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

/**
 * DB 공급가(BillingDeckProduct.monthlyPrice)로 가격을 다시 계산한다.
 * 어드민에서 가격을 바꿔도 마케팅 표시가가 실제 결제 금액과 같도록 페이지가 이 값을 쓴다.
 * DB 값이 없는 업무는 기본값을 유지한다.
 */
export function withLivePrices(
  rows: DeckPricingRow[],
  supplyPriceById: Record<string, number>
): DeckPricingRow[] {
  return rows.map((row) => {
    const supply = supplyPriceById[row.slug]
    if (supply === undefined || supply === row.supplyPrice) return row
    return { ...row, supplyPrice: supply, totalPrice: calcAmounts(supply).amount }
  })
}
