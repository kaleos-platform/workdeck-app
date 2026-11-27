import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DECK_META } from '@/lib/deck-meta'
import { DECK_LANDINGS } from '@/lib/marketing/decks'
import { MARKETING_DECK_SLUGS } from '@/lib/marketing/routes'

const LINK_CLASS = 'inline-flex items-center gap-1 text-sm font-medium text-foreground'

export function HomeDecks({ releasedIds }: { releasedIds: string[] }) {
  // 출시된 첫 업무가 큰 카드, 나머지는 작은 카드
  const featured = MARKETING_DECK_SLUGS.find((slug) => releasedIds.includes(slug))
  const rest = MARKETING_DECK_SLUGS.filter((slug) => slug !== featured)

  return (
    <section className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 space-y-2 text-center">
          <h2 className="text-2xl font-bold break-keep sm:text-3xl">필요한 업무만 골라 쓰세요</h2>
          <p className="break-keep text-muted-foreground">
            지금 쓸 수 있는 업무부터 시작하고, 다른 업무는 준비되는 대로 열립니다.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          {featured && <FeaturedCard slug={featured} />}
          {rest.map((slug) => {
            const Icon = DECK_META[slug].icon
            const released = releasedIds.includes(slug)
            return (
              <div key={slug} className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
                  </div>
                  {released ? null : <Badge variant="secondary">준비중</Badge>}
                </div>
                <div className="space-y-2">
                  <h3 className="text-base font-semibold break-keep">{DECK_META[slug].name}</h3>
                  <p className="line-clamp-2 text-sm break-keep text-muted-foreground">
                    {DECK_LANDINGS[slug].hero.subcopy}
                  </p>
                </div>
                <Link
                  href={released ? `/${slug}` : `/${slug}#apply`}
                  className={`${LINK_CLASS} mt-auto`}
                >
                  {released ? '자세히 보기' : '출시 알림 받기'}
                  <span className="sr-only"> — {DECK_META[slug].name}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function FeaturedCard({ slug }: { slug: (typeof MARKETING_DECK_SLUGS)[number] }) {
  const Icon = DECK_META[slug].icon
  return (
    <div className="col-span-2 flex flex-col gap-6 rounded-xl border bg-card p-6 lg:row-span-2">
      {slug === 'recruiting' && (
        <Image
          src="/marketing/recruiting/editor.webp"
          alt="공고 템플릿을 고르고 블록 에디터와 모바일 미리보기로 공고를 고치는 화면"
          width={1600}
          height={1000}
          className="h-auto w-full rounded-lg border"
        />
      )}
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
          <Icon className="h-5 w-5 text-blue-600" aria-hidden />
        </div>
        <h3 className="text-lg font-semibold break-keep">{DECK_META[slug].name}</h3>
        <Badge variant="secondary">지금 사용 가능</Badge>
      </div>
      <p className="text-base break-keep text-muted-foreground">
        {DECK_LANDINGS[slug].hero.subcopy}
      </p>
      <Link href={`/${slug}`} className={`${LINK_CLASS} mt-auto`}>
        자세히 보기
        <span className="sr-only"> — {DECK_META[slug].name}</span>
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  )
}
