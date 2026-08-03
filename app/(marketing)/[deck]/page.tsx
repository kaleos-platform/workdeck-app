import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DeckLanding } from '@/components/marketing/landing/deck-landing'
import { JsonLd } from '@/components/marketing/json-ld'
import { MARKETING_DECK_SLUGS, type MarketingDeckSlugString } from '@/lib/marketing/routes'
import { DECK_LANDINGS } from '@/lib/marketing/decks'
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

  return (
    <>
      <JsonLd data={softwareAppJsonLd(content)} />
      <JsonLd data={faqJsonLd(content.faq)} />
      <DeckLanding content={content} />
    </>
  )
}
