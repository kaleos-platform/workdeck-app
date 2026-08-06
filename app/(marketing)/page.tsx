import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildAppUrl } from '@/lib/domain'
import { DECK_META } from '@/lib/deck-meta'
import { DECK_LANDINGS } from '@/lib/marketing/decks'
import { MARKETING_DECK_SLUGS } from '@/lib/marketing/routes'
import { buildMarketingMetadata, orgJsonLd, websiteJsonLd } from '@/lib/marketing/seo'
import { JsonLd } from '@/components/marketing/json-ld'

export function generateMetadata(): Metadata {
  return buildMarketingMetadata({
    title: 'Workdeck — 여러 비즈니스 업무를 하나의 워크스페이스로',
    description:
      '쿠팡 광고 분석, 재고·배송 운영, 재무 관리, 채용, 세일즈 콘텐츠, 블로그 운영까지 — 필요한 업무만 골라 쓰는 올인원 비즈니스 워크스페이스, Workdeck.',
    path: '/',
    keywords: ['Workdeck', '비즈니스 워크스페이스', '이커머스 운영 툴', '쿠팡 광고 분석'],
  })
}

const trustPoints = [
  '베타 기간 동안 모든 업무를 무료로 이용 가능',
  '필요한 업무만 골라서 사용 — 강제 번들 없음',
  '실제 셀러·운영팀 워크플로우를 기반으로 설계',
]

export default function HomePage() {
  return (
    <div className="w-full">
      <JsonLd data={orgJsonLd()} />
      <JsonLd data={websiteJsonLd()} />

      {/* Hero */}
      <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
        <div className="mx-auto max-w-4xl space-y-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight break-keep sm:text-5xl lg:text-6xl">
            여러 비즈니스 업무를
            <span className="block bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
              하나의 워크스페이스에서
            </span>
          </h1>
          <p className="mx-auto max-w-2xl text-lg break-keep text-muted-foreground sm:text-xl">
            Workdeck은 광고 분석, 재고·배송 운영, 재무 관리, 채용, 세일즈 콘텐츠, 블로그 운영 같은
            비즈니스 업무를 필요한 것만 골라 쓰며 목표를 달성하는 워크스페이스입니다.
          </p>
          <div className="flex flex-col justify-center gap-4 pt-4 sm:flex-row">
            <Link href={buildAppUrl('/signup')}>
              <Button size="lg" className="w-full gap-2 sm:w-auto">
                무료로 시작하기
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </Link>
            <Link href={buildAppUrl('/login')}>
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                로그인
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* 덱 그리드 */}
      <section className="border-t bg-muted/30 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 space-y-3 text-center">
            <h2 className="text-2xl font-bold break-keep sm:text-3xl">필요한 업무만 골라 쓰세요</h2>
            <p className="mx-auto max-w-2xl break-keep text-muted-foreground">
              6개 업무 중 지금 필요한 것부터 시작하고, 필요해지면 언제든 추가하세요.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {MARKETING_DECK_SLUGS.map((slug) => {
              const meta = DECK_META[slug]
              const content = DECK_LANDINGS[slug]
              const Icon = meta.icon
              return (
                <Link
                  key={slug}
                  href={`/${slug}`}
                  className="group flex flex-col gap-4 rounded-xl border bg-card p-6 transition-colors hover:border-foreground/20"
                >
                  <div
                    className={`flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br ${meta.gradient}`}
                  >
                    <Icon className="h-5 w-5 text-white" aria-hidden />
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="font-semibold break-keep">{meta.name}</h3>
                    <p className="text-sm break-keep text-muted-foreground">
                      {content.hero.subcopy}
                    </p>
                  </div>
                  <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-foreground/80 group-hover:gap-1.5">
                    자세히 보기
                    <ArrowRight
                      className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      {/* 신뢰 섹션 */}
      <section className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <ul className="space-y-4">
            {trustPoints.map((point) => (
              <li key={point} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                <span className="text-base break-keep">{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 최종 CTA */}
      <section className="bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-16 text-white sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <h2 className="text-2xl font-bold break-keep sm:text-3xl">
            지금 바로 워크스페이스를 만들어보세요
          </h2>
          <p className="text-lg break-keep text-white/90">
            베타 기간 동안 모든 업무를 무료로 이용할 수 있습니다.
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
