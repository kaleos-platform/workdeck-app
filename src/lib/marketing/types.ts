import type { DeckVariant } from '@/lib/deck-meta'

/** 마케팅 랜딩이 존재하는 deck 슬러그 — 'workdeck'(브랜드 홈)은 제외 */
export type MarketingDeckSlug = Exclude<DeckVariant, 'workdeck'>

export interface DeckLandingSeo {
  title: string
  description: string
  keywords: string[]
}

export interface DeckLandingCta {
  label: string
  href: string
}

export interface DeckLandingHero {
  headline: string
  highlight?: string
  subcopy: string
  primaryCta: DeckLandingCta
  secondaryCta?: DeckLandingCta
}

export interface DeckLandingPainPoint {
  title: string
  description: string
}

export interface DeckLandingFeature {
  /** FEATURE_ICONS 매핑 키 (UI 쪽에서 아이콘으로 변환) */
  icon: string
  title: string
  description: string
}

export interface DeckLandingScreenshot {
  src: string
  alt: string
  caption?: string
}

export interface DeckLandingWorkflowStep {
  step: number
  title: string
  description: string
}

export interface DeckLandingFaqItem {
  question: string
  answer: string
}

export interface DeckLandingFinalCta {
  headline: string
  subcopy?: string
}

export interface DeckLandingContent {
  slug: MarketingDeckSlug
  seo: DeckLandingSeo
  hero: DeckLandingHero
  painPoints?: DeckLandingPainPoint[]
  features: DeckLandingFeature[]
  screenshots?: DeckLandingScreenshot[]
  workflow?: DeckLandingWorkflowStep[]
  faq: DeckLandingFaqItem[]
  finalCta: DeckLandingFinalCta
  relatedDecks?: MarketingDeckSlug[]
}
