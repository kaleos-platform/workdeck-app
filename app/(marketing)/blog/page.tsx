import Link from 'next/link'
import type { Metadata } from 'next'
import { CalendarDays } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DECK_META } from '@/lib/deck-meta'
import { getAllPosts } from '@/lib/marketing/blog'
import { buildMarketingMetadata } from '@/lib/marketing/seo'

export function generateMetadata(): Metadata {
  return buildMarketingMetadata({
    title: '블로그 — Workdeck',
    description:
      '쿠팡 광고 분석, 재무 관리, 재고·배송 운영 등 실무에 바로 쓸 수 있는 가이드를 Workdeck 블로그에서 확인하세요.',
    path: '/blog',
    keywords: ['Workdeck 블로그', '쿠팡 광고 가이드', '재무 관리 가이드'],
  })
}

export default function BlogListPage() {
  const posts = getAllPosts()

  return (
    <div className="w-full">
      <section className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-4 text-center">
          <h1 className="text-4xl font-bold tracking-tight break-keep sm:text-5xl">블로그</h1>
          <p className="mx-auto max-w-2xl text-lg break-keep text-muted-foreground">
            광고 분석, 재무 관리, 운영 자동화까지 — 실무에 바로 적용할 수 있는 가이드를 전합니다.
          </p>
        </div>
      </section>

      <section className="border-t px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl">
          {posts.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">
              아직 등록된 글이 없습니다. 곧 실무 가이드로 찾아뵙겠습니다.
            </p>
          ) : (
            <ul className="space-y-6">
              {posts.map((post) => {
                const deckMeta = post.deck ? DECK_META[post.deck] : undefined

                return (
                  <li key={post.slug}>
                    <Link
                      href={`/blog/${post.slug}`}
                      className="block rounded-lg border p-6 transition-colors hover:bg-muted/40"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <CalendarDays className="h-4 w-4" aria-hidden />
                        <time dateTime={post.date}>{post.date}</time>
                        {deckMeta ? <Badge variant="outline">{deckMeta.name}</Badge> : null}
                      </div>
                      <h2 className="mt-3 text-xl font-bold break-keep">{post.title}</h2>
                      <p className="mt-2 line-clamp-2 break-keep text-muted-foreground">
                        {post.description}
                      </p>
                      {post.tags.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {post.tags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
