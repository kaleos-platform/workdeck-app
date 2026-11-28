import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MARKETING_CTA_CLASS } from '@/components/marketing/cta-class'
import { buildMarketingUrl } from '@/lib/domain'
import { DECK_PRICING_ROWS, withLivePrices } from '@/lib/marketing/pricing-data'
import { getMarketingDeckStatus } from '@/lib/billing/deck-release'
import { buildMarketingMetadata, faqJsonLd } from '@/lib/marketing/seo'
import { PricingCards } from '@/components/marketing/pricing/pricing-cards'
import { JsonLd } from '@/components/marketing/json-ld'
import { FaqSection } from '@/components/marketing/landing/faq-section'
import type { DeckLandingFaqItem } from '@/lib/marketing/types'

export function generateMetadata(): Metadata {
  return buildMarketingMetadata({
    title: '요금제 — Workdeck',
    description:
      '필요한 업무 모듈만 골라 월 단위로 구독하세요. 업무별 구독료와 이용 조건을 확인할 수 있습니다.',
    path: '/pricing',
    keywords: ['Workdeck 요금제', 'Workdeck 가격', '업무별 구독료'],
  })
}

const faq: DeckLandingFaqItem[] = [
  {
    question: '결제는 어떻게 이루어지나요?',
    answer:
      '워크스페이스에 카드를 등록하면 구독한 업무 모듈의 합계 금액이 매월 자동으로 결제됩니다. 결제는 토스페이먼츠를 통해 처리되며 카드 정보는 회사 서버에 저장되지 않습니다.',
  },
  {
    question: '여러 업무를 한 번에 구독해야 하나요?',
    answer:
      '아니요. 필요한 업무만 골라 구독하는 방식이며, 사용하지 않는 업무는 결제되지 않습니다. 이용 기간 중 업무를 추가하면 남은 기간만큼 일할 계산된 금액이 결제됩니다.',
  },
  {
    question: '해지하면 언제까지 이용할 수 있나요?',
    answer:
      '워크스페이스 설정에서 언제든 해지할 수 있습니다. 이미 결제한 이용 기간의 마지막 날까지는 그대로 이용할 수 있고, 다음 주기부터 결제되지 않습니다. 자세한 기준은 취소·환불 규정을 확인해 주세요.',
  },
  {
    question: '표시된 금액에 부가세가 포함되어 있나요?',
    answer:
      '네. 표시 금액은 부가세가 포함된 실제 결제 금액이며, 괄호 안 금액은 세금계산서 기준 공급가입니다.',
  },
]

export default async function PricingPage() {
  // 표시가 = 결제가: 가격은 결제에 쓰는 DB 공급가로 계산한다
  const { releasedIds, supplyPriceById } = await getMarketingDeckStatus()
  const pricingRows = withLivePrices(DECK_PRICING_ROWS, supplyPriceById)
  return (
    <div className="w-full">
      <JsonLd data={faqJsonLd(faq)} />

      {/* 헤더 */}
      <section className="px-4 pt-16 pb-8 sm:px-6 sm:pt-24 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-4">
          <h1 className="text-4xl font-bold tracking-tight break-keep sm:text-5xl">요금제</h1>
          <p className="text-lg break-keep text-muted-foreground">
            쓰는 업무만 월 단위로 구독하세요. 표시 금액은 부가세 포함입니다.
          </p>
        </div>
      </section>

      {/* 업무별 가격 카드 */}
      <section className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <PricingCards rows={pricingRows} releasedIds={releasedIds} />
        </div>
      </section>

      <FaqSection faq={faq} />

      {/* 최종 CTA */}
      <section className="bg-blue-50 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <h2 className="text-2xl font-bold break-keep sm:text-3xl">
            필요한 업무만 골라 시작하세요
          </h2>
          <p className="text-lg break-keep text-muted-foreground">
            워크스페이스를 만들고 원하는 업무 모듈을 구독하면 바로 이용할 수 있습니다.
          </p>
          <Link href={buildMarketingUrl('/recruiting#lead-form')}>
            <Button size="lg" className={`gap-2 ${MARKETING_CTA_CLASS}`}>
              도입 문의하기
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  )
}
