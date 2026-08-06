import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { DECK_META } from '@/lib/deck-meta'
import type { MarketingDeckSlug } from '@/lib/marketing/types'

export function DeckCrossLinks({ relatedDecks }: { relatedDecks: MarketingDeckSlug[] }) {
  if (relatedDecks.length === 0) return null

  return (
    <section className="border-t px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <h2 className="mb-8 text-center text-2xl font-bold break-keep sm:text-3xl">
          함께 사용하면 좋은 덱
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {relatedDecks.map((slug) => {
            const meta = DECK_META[slug]
            const Icon = meta.icon
            return (
              <Link
                key={slug}
                href={`/${slug}`}
                className="group flex items-center gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-foreground/20"
              >
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${meta.gradient}`}
                >
                  <Icon className="h-5 w-5 text-white" aria-hidden />
                </div>
                <span className="flex-1 font-medium break-keep">{meta.name}</span>
                <ArrowRight
                  className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
