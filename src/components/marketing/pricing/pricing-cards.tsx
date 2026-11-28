import Link from 'next/link'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MARKETING_CTA_CLASS } from '@/components/marketing/cta-class'
import { buildMarketingUrl } from '@/lib/domain'
import { DECK_META } from '@/lib/deck-meta'
import { DECK_LANDINGS } from '@/lib/marketing/decks'
import type { DeckPricingRow } from '@/lib/marketing/pricing-data'

const won = (n: number) => n.toLocaleString('ko-KR')

const CONDITIONS = ['처음 만드는 작업 공간 7일 무료 체험', '매월 카드 자동결제', '언제든 해지']

function SellingCard({ row }: { row: DeckPricingRow }) {
  const { slug } = row
  const landing = DECK_LANDINGS[slug]
  // 도입 문의 폼이 없는 업무는 모집 관리 폼으로 보낸다
  const leadHref = buildMarketingUrl(
    landing.leadForm ? `/${slug}#lead-form` : '/recruiting#lead-form'
  )
  return (
    <div className="grid gap-8 rounded-xl border bg-card p-6 sm:p-8 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h3 className="text-xl font-semibold break-keep">{DECK_META[slug].name}</h3>
          <Badge variant="outline" className="text-emerald-600">
            판매 중
          </Badge>
        </div>
        <p className="break-keep text-muted-foreground">{landing.hero.subcopy}</p>
        <p className="text-sm text-muted-foreground">
          <span className="text-2xl font-semibold text-foreground">월 {won(row.totalPrice)}원</span>{' '}
          (VAT 포함 / 공급가 {won(row.supplyPrice)}원)
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
          <Button asChild className={MARKETING_CTA_CLASS}>
            <Link href={leadHref}>
              도입 문의하기
              <span className="sr-only"> ({DECK_META[row.slug].name})</span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Link
            href={`/pricing/${slug}`}
            className="text-sm font-medium text-foreground hover:underline"
          >
            상품 상세·구매 <span aria-hidden>→</span>
            <span className="sr-only"> ({DECK_META[row.slug].name})</span>
          </Link>
          <Link href={`/${slug}`} className="text-sm text-muted-foreground hover:text-foreground">
            기능 소개 <span aria-hidden>→</span>
            <span className="sr-only"> ({DECK_META[row.slug].name})</span>
          </Link>
        </div>
      </div>
      <div className="space-y-3">
        <h4 className="text-sm font-semibold">포함 기능</h4>
        <ul className="space-y-2">
          {landing.features.map((f) => (
            <li key={f.title} className="flex items-start gap-2 text-sm break-keep">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden />
              {f.title}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function SoonCard({ row }: { row: DeckPricingRow }) {
  const { slug } = row
  const Icon = DECK_META[slug].icon
  const name = DECK_META[slug].name
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <Badge variant="secondary">준비중</Badge>
      </div>
      <h4 className="font-semibold break-keep">{name}</h4>
      <p className="line-clamp-2 text-sm break-keep text-muted-foreground">
        {DECK_LANDINGS[slug].hero.subcopy}
      </p>
      <Link
        href={`/${slug}#apply`}
        className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
      >
        출시 알림 받기 →<span className="sr-only"> ({name})</span>
      </Link>
    </div>
  )
}

export function PricingCards({
  rows,
  releasedIds,
}: {
  rows: DeckPricingRow[]
  releasedIds: string[]
}) {
  const selling = rows.filter((r) => releasedIds.includes(r.slug))
  const soon = rows.filter((r) => !releasedIds.includes(r.slug))
  return (
    <div className="space-y-12">
      <div className="space-y-6">
        {selling.map((row) => (
          <SellingCard key={row.slug} row={row} />
        ))}
        {selling.length > 0 && (
          <>
            <ul className="flex flex-wrap gap-2">
              {CONDITIONS.map((c) => (
                <li key={c}>
                  <Badge variant="secondary">{c}</Badge>
                </li>
              ))}
              <li>
                <Link href="/refund" className="text-sm font-medium hover:underline">
                  취소·환불 규정 →
                </Link>
              </li>
            </ul>
            <p className="text-sm break-keep text-muted-foreground">
              표시된 금액은 VAT가 포함된 실제 결제 금액이며, 괄호 안은 세금계산서 기준 공급가입니다.
              결제는 카드 자동결제로 매월 청구되며, 취소·환불 기준은 취소·환불 규정을 따릅니다.
            </p>
          </>
        )}
      </div>
      {soon.length > 0 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">준비 중인 업무</h3>
            <p className="text-sm text-muted-foreground">출시되면 요금을 안내드려요.</p>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {soon.map((row) => (
              <SoonCard key={row.slug} row={row} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
