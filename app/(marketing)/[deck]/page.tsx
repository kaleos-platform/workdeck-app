import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DeckLanding } from '@/components/marketing/landing/deck-landing'
import { JsonLd } from '@/components/marketing/json-ld'
import { MARKETING_DECK_SLUGS, type MarketingDeckSlugString } from '@/lib/marketing/routes'
import { DECK_LANDINGS } from '@/lib/marketing/decks'
import { DECK_PRICING_ROWS, withLivePrices } from '@/lib/marketing/pricing-data'
import { getMarketingDeckStatus } from '@/lib/billing/deck-release'
import { buildMarketingMetadata, faqJsonLd, softwareAppJsonLd } from '@/lib/marketing/seo'

interface DeckPageProps {
  params: Promise<{ deck: string }>
}

function isDeckSlug(value: string): value is MarketingDeckSlugString {
  return (MARKETING_DECK_SLUGS as readonly string[]).includes(value)
}

export function generateStaticParams() {
  return MARKETING_DECK_SLUGS.map((deck) => ({ deck }))
}

export async function generateMetadata({ params }: DeckPageProps): Promise<Metadata> {
  const { deck } = await params
  if (!isDeckSlug(deck)) return {}

  const content = DECK_LANDINGS[deck]
  return buildMarketingMetadata({
    title: content.seo.title,
    description: content.seo.description,
    keywords: content.seo.keywords,
    path: `/${deck}`,
  })
}

export default async function DeckLandingPage({ params }: DeckPageProps) {
  const { deck } = await params
  if (!isDeckSlug(deck)) notFound()

  const content = DECK_LANDINGS[deck]
  const { releasedIds, supplyPriceById } = await getMarketingDeckStatus()
  const released = releasedIds.includes(deck)
  const price = withLivePrices(DECK_PRICING_ROWS, supplyPriceById).find((r) => r.slug === deck)

  return (
    <>
      <JsonLd data={softwareAppJsonLd(content, released && price ? price.totalPrice : null)} />
      <JsonLd data={faqJsonLd(content.faq)} />
      <DeckLanding content={content} released={released} />
    </>
  )
}
