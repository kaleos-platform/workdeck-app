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
  /** CTA 아래 한 줄 안내(가격·체험 등) */
  note?: string
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
  /** featureStyle 'rows'에서 설명 위에 크게 쓰는 한 줄 */
  headline?: string
  /** featureStyle 'rows'에서 설명 옆에 놓는 화면 이미지 */
  image?: DeckLandingScreenshot
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

export interface DeckLandingLeadForm {
  headline: string
  subcopy: string
  /** 제출 완료 문구 (없으면 기본 도입 신청 안내) */
  doneMessage?: string
}

export interface DeckLandingContent {
  slug: MarketingDeckSlug
  seo: DeckLandingSeo
  hero: DeckLandingHero
  painPoints?: DeckLandingPainPoint[]
  features: DeckLandingFeature[]
  /** 'rows' = 기능을 설명+이미지 교차 행으로. 기본은 카드 그리드 */
  featureStyle?: 'grid' | 'rows'
  /** 이 업무를 주로 쓰는 업종·현장 칩 */
  industries?: string[]
  /** utm_source가 맞는 방문자에게만 보이는 이전 안내 */
  migration?: DeckLandingMigration
  screenshots?: DeckLandingScreenshot[]
  workflow?: DeckLandingWorkflowStep[]
  faq: DeckLandingFaqItem[]
  finalCta: DeckLandingFinalCta
  /** 있으면 '도입 신청' 폼 섹션(#apply)을 렌더하고 주 CTA 를 폼으로 연결한다 */
  leadForm?: DeckLandingLeadForm
  relatedDecks?: MarketingDeckSlug[]
}

export interface DeckLandingMigration {
  /** 이 값과 utm_source가 같을 때만 렌더 */
  utmSource: string
  headline: string
  points: string[]
  ctas: DeckLandingCta[]
  /** 기능 아래에 붙는 이전 전·후 대응표 */
  comparison: {
    headline: string
    columns: [string, string, string]
    /** same=true면 차이 칸을 정상색, 아니면 주의색으로 */
    rows: { before: string; after: string; diff: string; same: boolean }[]
  }
}
