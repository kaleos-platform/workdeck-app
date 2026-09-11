import { DECK_META } from '@/lib/deck-meta'
import type { DeckLandingContent } from '@/lib/marketing/types'
import { HeroSection } from './hero-section'
import { PainPoints } from './pain-points'
import { FeatureGrid } from './feature-grid'
import { WorkflowSection } from './workflow-section'
import { ScreenshotShowcase } from './screenshot-showcase'
import { FaqSection } from './faq-section'
import { CtaSection } from './cta-section'
import { DeckCrossLinks } from './deck-cross-links'

/**
 * deck 랜딩 공용 템플릿 — DeckLandingContent(데이터) + DECK_META(브랜드) join 후 섹션 조립.
 * 인터랙션이 필요한 하위 섹션(FaqSection의 Accordion 등)만 클라이언트 컴포넌트.
 */
export function DeckLanding({ content }: { content: DeckLandingContent }) {
  const meta = DECK_META[content.slug]

  // [시작하기]는 이 업무를 보고 온 사람을 위한 CTA다. 가입 후 곧장 해당 업무의
  // 구독 확인 단계로 이어지도록 목적지를 실어 보낸다 (로그인 상태면 바로 도착).
  const startHref = `/signup?redirectTo=${encodeURIComponent(`/my-deck?subscribe=${content.slug}`)}`
  const primaryCta = { ...content.hero.primaryCta, href: startHref }

  return (
    <div className="w-full">
      <HeroSection
        hero={{ ...content.hero, primaryCta }}
        deckName={meta.name}
        gradient={meta.gradient}
        icon={meta.icon}
      />

      {content.painPoints && content.painPoints.length > 0 ? (
        <PainPoints points={content.painPoints} />
      ) : null}

      <FeatureGrid features={content.features} gradient={meta.gradient} />

      {content.workflow && content.workflow.length > 0 ? (
        <WorkflowSection steps={content.workflow} gradient={meta.gradient} />
      ) : null}

      {content.screenshots && content.screenshots.length > 0 ? (
        <ScreenshotShowcase screenshots={content.screenshots} />
      ) : null}

      <FaqSection faq={content.faq} />

      <CtaSection finalCta={content.finalCta} primaryCta={primaryCta} gradient={meta.gradient} />

      {content.relatedDecks && content.relatedDecks.length > 0 ? (
        <DeckCrossLinks relatedDecks={content.relatedDecks} />
      ) : null}
    </div>
  )
}
