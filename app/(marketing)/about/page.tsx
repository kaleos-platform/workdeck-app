import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildAppUrl } from '@/lib/domain'
import { DECK_META } from '@/lib/deck-meta'
import { MARKETING_DECK_SLUGS } from '@/lib/marketing/routes'
import { buildMarketingMetadata, orgJsonLd } from '@/lib/marketing/seo'
import { JsonLd } from '@/components/marketing/json-ld'

export function generateMetadata(): Metadata {
  return buildMarketingMetadata({
    title: '소개 — Workdeck',
    description:
      'Workdeck은 광고 분석, 재고·배송 운영, 재무 관리, 채용, 세일즈 콘텐츠, 블로그 운영을 필요한 것만 골라 쓰는 올인원 비즈니스 워크스페이스입니다.',
    path: '/about',
    keywords: ['Workdeck 소개', 'Workdeck 회사'],
  })
}

export default function AboutPage() {
  return (
    <div className="w-full">
      <JsonLd data={orgJsonLd()} />

      <section className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <h1 className="text-4xl font-bold tracking-tight break-keep sm:text-5xl">
            Workdeck 소개
          </h1>
          <p className="mx-auto max-w-2xl text-lg break-keep text-muted-foreground">
            Workdeck은 여러 비즈니스 업무를 하나의 워크스페이스에서 필요한 것만 골라 쓰며 비즈니스
            목표를 달성하는 웹 서비스입니다.
          </p>
        </div>
      </section>

      <section className="border-t px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="space-y-3">
            <h2 className="text-2xl font-bold break-keep">우리가 만드는 것</h2>
            <p className="leading-relaxed break-keep text-muted-foreground">
              쿠팡 광고 리포트를 매일 손으로 정리하고, 재고와 배송을 여러 스프레드시트로 나눠
              관리하고, 재무 데이터를 뒤늦게 정산하는 실무자의 반복 업무를 줄이는 것이 Workdeck의
              목표입니다. 실제 셀러·운영팀의 워크플로우를 관찰하며 업무별 모듈을 설계했고, 필요한
              업무만 골라 쓸 수 있도록 하나의 워크스페이스 안에 묶었습니다.
            </p>
          </div>
          <div className="space-y-3">
            <h2 className="text-2xl font-bold break-keep">앞으로의 방향</h2>
            <p className="leading-relaxed break-keep text-muted-foreground">
              지금은 광고 자동화·브랜드 운영·재무 관리·채용·세일즈 콘텐츠·블로그 운영 6개 업무를
              베타로 운영하고 있으며, 사용자 워크플로우에 맞춰 새로운 업무를 계속 추가해 나갈
              계획입니다.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t bg-muted/30 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-8 text-center text-2xl font-bold break-keep">현재 제공 중인 업무</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {MARKETING_DECK_SLUGS.map((slug) => {
              const meta = DECK_META[slug]
              const Icon = meta.icon
              return (
                <Link
                  key={slug}
                  href={`/${slug}`}
                  className="group flex items-center gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-foreground/20"
                >
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${meta.gradient}`}
                  >
                    <Icon className="h-5 w-5 text-white" aria-hidden />
                  </div>
                  <span className="font-semibold break-keep">{meta.name}</span>
                  <ArrowRight
                    className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-16 text-white sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <h2 className="text-2xl font-bold break-keep sm:text-3xl">함께 만들어가요</h2>
          <p className="text-lg break-keep text-white/90">
            베타 기간 동안 모든 업무를 무료로 이용하며 의견을 들려주세요.
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
