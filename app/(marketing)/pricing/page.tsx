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
      'Workdeck은 현재 모든 업무가 베타 기간 동안 무료입니다. 업무별 정식 전환 예정가와 이용 조건을 확인하세요.',
    path: '/pricing',
    keywords: ['Workdeck 요금제', 'Workdeck 가격', '업무별 구독료'],
  })
}

const faq: DeckLandingFaqItem[] = [
  {
    question: '베타 기간은 언제까지인가요?',
    answer:
      '현재 모든 업무가 베타 기간으로 무료입니다. 정식 유료 전환 일정은 확정되는 대로 서비스 내 공지와 이메일로 사전 안내드립니다.',
  },
  {
    question: '유료로 전환되면 지금까지 쌓은 데이터는 어떻게 되나요?',
    answer:
      '업로드하신 광고·재무·재고 등 데이터는 이용자 소유이며 유료 전환과 무관하게 그대로 유지됩니다. 전환 시점에도 기존 데이터 접근에는 영향이 없습니다.',
  },
  {
    question: '여러 업무를 한 번에 구독해야 하나요?',
    answer:
      '아니요. 필요한 업무만 골라 구독하는 방식입니다. 정식 전환 이후에도 사용하지 않는 업무까지 강제로 결제되지 않습니다.',
  },
  {
    question: '해지는 어떻게 하나요?',
    answer:
      '정식 유료 전환 이후 워크스페이스 설정에서 업무별로 언제든 해지할 수 있으며, 이미 결제한 기간까지는 정상적으로 이용할 수 있습니다.',
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
            지금은 모든 업무 무료 베타 기간
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight break-keep sm:text-5xl">요금제</h1>
          <p className="mx-auto max-w-2xl text-lg break-keep text-muted-foreground">
            Workdeck의 모든 업무는 베타 기간 동안 무료로 이용할 수 있습니다. 아래는 정식 전환 시
            적용될 예정가이며, 전환 전 서비스 내 공지를 통해 미리 안내드립니다.
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
                      베타 기간 무료
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="font-semibold break-keep">{meta.name}</h3>
                    <p className="text-sm break-keep text-muted-foreground">{row.summary}</p>
                  </div>
                  <div className="mt-auto space-y-1 border-t pt-4">
                    <p className="text-sm text-muted-foreground">
                      정식 전환 예정가{' '}
                      <span className="font-semibold text-foreground">
                        월 {row.supplyPrice.toLocaleString('ko-KR')}원
                      </span>{' '}
                      (VAT 포함 {row.totalPrice.toLocaleString('ko-KR')}원)
                    </p>
                    <Link
                      href={`/${row.slug}`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-foreground/80 hover:gap-1.5"
                    >
                      자세히 보기
                      <ArrowRight className="h-3.5 w-3.5 transition-transform" aria-hidden />
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="mx-auto mt-10 max-w-2xl text-center text-sm break-keep text-muted-foreground">
            표시된 금액은 공급가(VAT 별도) 기준 예정가이며, 괄호 안은 VAT 포함 결제 예정 금액입니다.
            필요한 업무만 선택해 구독할 수 있으며, 정식 전환 일정과 조건은 사전 공지됩니다.
          </p>
        </div>
      </section>

      <FaqSection faq={faq} />

      {/* 최종 CTA */}
      <section className="bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-16 text-white sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <h2 className="text-2xl font-bold break-keep sm:text-3xl">
            베타 기간, 지금 시작하면 무료입니다
          </h2>
          <p className="text-lg break-keep text-white/90">
            필요한 업무만 골라 워크스페이스를 만들어보세요.
          </p>
          <Link href={buildAppUrl('/signup')}>
            <Button size="lg" variant="secondary" className="gap-2">
              무료로 시작하기
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  )
}
