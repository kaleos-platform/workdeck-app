import type { Metadata } from 'next'
import { buildMarketingUrl } from '@/lib/domain'
import type { DeckLandingContent, DeckLandingFaqItem } from './types'

const SITE_NAME = 'Workdeck'

export interface BuildMarketingMetadataInput {
  title: string
  description: string
  path: string
  keywords?: string[]
}

/**
 * 마케팅 페이지 공용 Metadata 빌더.
 * canonical은 항상 절대 URL (preview/localhost가 앱 호스트로 오인되지 않도록 buildMarketingUrl 사용).
 */
export function buildMarketingMetadata({
  title,
  description,
  path,
  keywords,
}: BuildMarketingMetadataInput): Metadata {
  const url = buildMarketingUrl(path)

  return {
    title,
    description,
    keywords,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: 'ko_KR',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

/** Organization JSON-LD — 브랜드 홈/공용 페이지에 사용 */
export function orgJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: buildMarketingUrl('/'),
  }
}

/** WebSite JSON-LD — 브랜드 홈에서 orgJsonLd와 함께 사용 */
export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: buildMarketingUrl('/'),
  }
}

/** SoftwareApplication JSON-LD — deck 랜딩 페이지에 사용 (현재 베타 무료) */
export function softwareAppJsonLd(content: DeckLandingContent) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: content.seo.title,
    description: content.seo.description,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: buildMarketingUrl(`/${content.slug}`),
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'KRW',
    },
  }
}

/** FAQPage JSON-LD — deck 랜딩/공용 페이지의 faq 섹션에 사용 */
export function faqJsonLd(faq: DeckLandingFaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
}
