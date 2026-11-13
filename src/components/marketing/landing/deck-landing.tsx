import { DECK_META } from '@/lib/deck-meta'
import type { DeckLandingContent, DeckLandingLeadForm } from '@/lib/marketing/types'
import { HeroSection } from './hero-section'
import { PainPoints } from './pain-points'
import { FeatureGrid } from './feature-grid'
import { WorkflowSection } from './workflow-section'
import { ScreenshotShowcase } from './screenshot-showcase'
import { FaqSection } from './faq-section'
import { CtaSection } from './cta-section'
import { LeadFormSection } from './lead-form-section'
import { DeckCrossLinks } from './deck-cross-links'

/** 준비중 업무 — 기존 도입 문의(리드) 폼을 출시 알림 신청으로 쓴다 */
const RELEASE_NOTIFY_FORM: DeckLandingLeadForm = {
  headline: '출시 알림 받기',
  subcopy:
    '이 업무는 출시를 준비하고 있습니다. 정보를 남겨 주시면 출시되는 대로 이메일로 알려드립니다.',
  doneMessage: '출시 알림 신청이 완료되었습니다. 출시되는 대로 이메일로 알려드릴게요.',
}

/**
 * deck 랜딩 공용 템플릿 — DeckLandingContent(데이터) + DECK_META(브랜드) join 후 섹션 조립.
 * 인터랙션이 필요한 하위 섹션(FaqSection의 Accordion 등)만 클라이언트 컴포넌트.
 */
export function DeckLanding({
  content,
  released,
}: {
  content: DeckLandingContent
  /** false=준비중 — 시작하기·구독 CTA 대신 출시 알림 폼 */
  released: boolean
}) {
  const meta = DECK_META[content.slug]
  const leadForm = released ? content.leadForm : RELEASE_NOTIFY_FORM

  // [시작하기]는 이 업무를 보고 온 사람을 위한 CTA다. 가입 후 곧장 해당 업무의
  // 구독 확인 단계로 이어지도록 목적지를 실어 보낸다 (로그인 상태면 바로 도착).
  const startHref = `/signup?redirectTo=${encodeURIComponent(`/my-deck?subscribe=${content.slug}`)}`
  const startCta = { ...content.hero.primaryCta, href: startHref }
  // 도입 신청 폼이 있으면 주 CTA 는 폼으로, 기존 [시작하기]는 보조 CTA 로 내린다.
  // 준비중이면 가입·구독 경로를 노출하지 않는다 (기존 이용 공간용 로그인만 유지).
  const primaryCta = !released
    ? { label: '출시 알림 받기', href: '#apply' }
    : leadForm
      ? { label: '무료 이용 신청', href: '#apply' }
      : startCta
  const heroSecondaryCta =
    released && leadForm ? { label: '바로 시작하기', href: startHref } : content.hero.secondaryCta

  return (
    <div className="w-full">
      <HeroSection
        hero={{ ...content.hero, primaryCta, secondaryCta: heroSecondaryCta }}
        deckName={meta.name}
        gradient={meta.gradient}
        icon={meta.icon}
        badge={released ? undefined : '준비중'}
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

      {leadForm ? <LeadFormSection leadForm={leadForm} deck={content.slug} /> : null}

      <FaqSection faq={content.faq} />

      <CtaSection finalCta={content.finalCta} primaryCta={primaryCta} gradient={meta.gradient} />

      {content.relatedDecks && content.relatedDecks.length > 0 ? (
        <DeckCrossLinks relatedDecks={content.relatedDecks} />
      ) : null}
    </div>
  )
}
