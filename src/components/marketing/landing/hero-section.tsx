import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildAppUrl } from '@/lib/domain'
import type { DeckLandingHero } from '@/lib/marketing/types'

interface HeroSectionProps {
  hero: DeckLandingHero
  deckName: string
  gradient: string
  icon: LucideIcon
}

export function HeroSection({ hero, deckName, gradient, icon: Icon }: HeroSectionProps) {
  return (
    <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-8 text-center">
        <div className="flex items-center justify-center gap-2">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br ${gradient}`}
          >
            <Icon className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-medium text-muted-foreground">{deckName}</span>
        </div>

        <h1 className="text-4xl font-bold tracking-tight break-keep sm:text-5xl lg:text-6xl">
          {hero.headline}
          {hero.highlight ? (
            <span className={`block bg-gradient-to-r ${gradient} bg-clip-text text-transparent`}>
              {hero.highlight}
            </span>
          ) : null}
        </h1>

        <p className="mx-auto max-w-2xl text-lg break-keep text-muted-foreground sm:text-xl">
          {hero.subcopy}
        </p>

        <div className="flex flex-col justify-center gap-4 pt-4 sm:flex-row">
          <Link href={buildAppUrl(hero.primaryCta.href)}>
            <Button size="lg" className="w-full sm:w-auto">
              {hero.primaryCta.label}
            </Button>
          </Link>
          {hero.secondaryCta ? (
            <Link href={buildAppUrl(hero.secondaryCta.href)}>
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                {hero.secondaryCta.label}
              </Button>
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  )
}
