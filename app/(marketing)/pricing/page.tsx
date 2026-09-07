import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { buildAppUrl } from '@/lib/domain'
import { DECK_META } from '@/lib/deck-meta'
import { DECK_PRICING_ROWS } from '@/lib/marketing/pricing-data'
import { buildMarketingMetadata, faqJsonLd } from '@/lib/marketing/seo'
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

export default function PricingPage() {
  return (
    <div className="w-full">
      <JsonLd data={faqJsonLd(faq)} />

      {/* 히어로 */}
      <section className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <Badge variant="secondary" className="gap-1.5 py-1.5">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            필요한 업무만 골라 월 단위 구독
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight break-keep sm:text-5xl">요금제</h1>
          <p className="mx-auto max-w-2xl text-lg break-keep text-muted-foreground">
            업무 모듈별로 월 구독료가 책정되어 있습니다. 필요한 업무만 선택해 구독하고, 언제든지
            해지할 수 있습니다.
          </p>
        </div>
      </section>

      {/* 업무별 가격 카드 */}
      <section className="border-t bg-muted/30 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {DECK_PRICING_ROWS.map((row) => {
              const meta = DECK_META[row.slug]
              const Icon = meta.icon
              return (
                <div key={row.slug} className="flex flex-col gap-4 rounded-xl border bg-card p-6">
                  <div className="flex items-center justify-between">
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br ${meta.gradient}`}
                    >
                      <Icon className="h-5 w-5 text-white" aria-hidden />
                    </div>
                    <Badge variant="outline" className="text-emerald-600">
                      판매 중
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="font-semibold break-keep">{meta.name}</h3>
                    <p className="text-sm break-keep text-muted-foreground">{row.summary}</p>
                  </div>
                  <div className="mt-auto space-y-2 border-t pt-4">
                    <p className="text-sm text-muted-foreground">
                      <span className="text-lg font-semibold text-foreground">
                        월 {row.totalPrice.toLocaleString('ko-KR')}원
                      </span>{' '}
                      (VAT 포함 / 공급가 {row.supplyPrice.toLocaleString('ko-KR')}원)
                    </p>
                    <div className="flex items-center gap-4">
                      <Link
                        href={`/pricing/${row.slug}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:gap-1.5"
                      >
                        상품 상세·구매
                        <ArrowRight className="h-3.5 w-3.5 transition-transform" aria-hidden />
                      </Link>
                      <Link
                        href={`/${row.slug}`}
                        className="text-sm text-muted-foreground hover:text-foreground"
                      >
                        기능 소개
                      </Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="mx-auto mt-10 max-w-2xl text-center text-sm break-keep text-muted-foreground">
            표시된 금액은 VAT가 포함된 실제 결제 금액이며, 괄호 안은 세금계산서 기준 공급가입니다.
            결제는 카드 자동결제로 매월 청구되며, 취소·환불 기준은 취소·환불 규정을 따릅니다.
          </p>
        </div>
      </section>

      <FaqSection faq={faq} />

      {/* 최종 CTA */}
      <section className="bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-16 text-white sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <h2 className="text-2xl font-bold break-keep sm:text-3xl">
            필요한 업무만 골라 시작하세요
          </h2>
          <p className="text-lg break-keep text-white/90">
            워크스페이스를 만들고 원하는 업무 모듈을 구독하면 바로 이용할 수 있습니다.
          </p>
          <Link href={buildAppUrl('/signup')}>
            <Button size="lg" variant="secondary" className="gap-2">
              시작하기
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  )
}
