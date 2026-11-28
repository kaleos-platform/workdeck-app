import { DECK_META } from '@/lib/deck-meta'
import { buildMarketingUrl } from '@/lib/domain'
import type { DeckLandingContent, DeckLandingLeadForm } from '@/lib/marketing/types'
import { HeroSection } from './hero-section'
import { TrustStrip } from './trust-strip'
import { PainPoints } from './pain-points'
import { FeatureGrid } from './feature-grid'
import { FeatureRows } from './feature-rows'
import { IndustryChips } from './industry-chips'
import { MigrationComparison, MigrationNotice } from './migration-sections'
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

  // 폼 없는 랜딩은 모집 관리 도입 문의로 연결한다.
  const primaryCta = !released
    ? { label: '출시 알림 받기', href: '#apply' }
    : {
        label: '도입 문의하기',
        href: leadForm ? '#lead-form' : buildMarketingUrl('/recruiting#lead-form'),
      }
  const heroSecondaryCta = content.hero.secondaryCta

  return (
    <div className="w-full">
      <HeroSection
        hero={{ ...content.hero, primaryCta, secondaryCta: heroSecondaryCta }}
        deckName={meta.name}
        icon={meta.icon}
        badge={released ? undefined : '준비중'}
      />

      {content.trustPoints && content.trustPoints.length > 0 ? (
        <TrustStrip points={content.trustPoints} />
      ) : null}

      {content.migration ? <MigrationNotice migration={content.migration} /> : null}

      {content.painPoints && content.painPoints.length > 0 ? (
        <PainPoints points={content.painPoints} />
      ) : null}

      {content.featureStyle === 'rows' ? (
        <FeatureRows features={content.features} />
      ) : (
        <FeatureGrid features={content.features} />
      )}

      {content.migration ? <MigrationComparison migration={content.migration} /> : null}

      {content.industries && content.industries.length > 0 ? (
        <IndustryChips industries={content.industries} />
      ) : null}

      {content.workflow && content.workflow.length > 0 ? (
        <WorkflowSection steps={content.workflow} />
      ) : null}

      {/* rows는 기능 행에 이미지가 이미 있으므로 하단 쇼케이스를 생략한다 */}
      {content.featureStyle !== 'rows' && content.screenshots && content.screenshots.length > 0 ? (
        <ScreenshotShowcase screenshots={content.screenshots} />
      ) : null}

      {leadForm ? <LeadFormSection leadForm={leadForm} deck={content.slug} /> : null}

      <FaqSection faq={content.faq} />

      <CtaSection finalCta={content.finalCta} primaryCta={primaryCta} />

      {content.relatedDecks && content.relatedDecks.length > 0 ? (
        <DeckCrossLinks relatedDecks={content.relatedDecks} />
      ) : null}
    </div>
  )
}
