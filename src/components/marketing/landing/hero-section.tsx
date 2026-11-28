import Image from 'next/image'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MARKETING_CTA_CLASS } from '@/components/marketing/cta-class'
import { buildAppUrl } from '@/lib/domain'
import type { DeckLandingHero } from '@/lib/marketing/types'

interface HeroSectionProps {
  hero: DeckLandingHero
  deckName: string
  icon: LucideIcon
  /** 덱 이름 옆 상태 배지 (예: 준비중) */
  badge?: string
}

function hrefOf(href: string, allowExternal: boolean) {
  return href.startsWith('#') ||
    (allowExternal && (href.startsWith('https://') || href.startsWith('http://')))
    ? href
    : buildAppUrl(href)
}

export function HeroSection({ hero, deckName, icon: Icon, badge }: HeroSectionProps) {
  if (hero.image) {
    const secondary = hero.secondaryCta
    return (
      <section className="px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-50">
                <Icon className="h-4 w-4 text-blue-600" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">{deckName}</span>
              {badge ? <Badge variant="secondary">{badge}</Badge> : null}
            </div>

            <h1 className="text-4xl font-bold tracking-tight break-keep sm:text-5xl">
              {hero.headline}
              {hero.highlight ? (
                <span className="block text-blue-600">{hero.highlight}</span>
              ) : null}
            </h1>

            <p className="max-w-xl text-lg break-keep text-muted-foreground">{hero.subcopy}</p>

            <div className="space-y-3 pt-2">
              <Button asChild size="lg" className={`w-full sm:w-auto ${MARKETING_CTA_CLASS}`}>
                <Link href={hrefOf(hero.primaryCta.href, true)}>{hero.primaryCta.label}</Link>
              </Button>
              {secondary ? (
                <p className="text-sm">
                  <Link
                    href={hrefOf(secondary.href, false)}
                    className="font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {secondary.label} <span aria-hidden>→</span>
                  </Link>
                </p>
              ) : null}
            </div>

            {hero.note ? (
              <p className="text-sm break-keep text-muted-foreground">{hero.note}</p>
            ) : null}
          </div>

          <Image
            src={hero.image.src}
            alt={hero.image.alt}
            width={hero.image.width ?? 1600}
            height={hero.image.height ?? 1000}
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="h-auto w-full rounded-xl border shadow-sm"
          />
        </div>
      </section>
    )
  }

  return (
    <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-8 text-center">
        <div className="flex items-center justify-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-50">
            <Icon className="h-4 w-4 text-blue-600" />
          </div>
          <span className="text-sm font-medium text-muted-foreground">{deckName}</span>
          {badge ? <Badge variant="secondary">{badge}</Badge> : null}
        </div>

        <h1 className="text-4xl font-bold tracking-tight break-keep sm:text-5xl lg:text-6xl">
          {hero.headline}
          {hero.highlight ? <span className="block text-blue-600">{hero.highlight}</span> : null}
        </h1>

        <p className="mx-auto max-w-2xl text-lg break-keep text-muted-foreground sm:text-xl">
          {hero.subcopy}
        </p>

        <div className="flex flex-col justify-center gap-4 pt-4 sm:flex-row">
          <Link
            href={
              hero.primaryCta.href.startsWith('#') ||
              hero.primaryCta.href.startsWith('https://') ||
              hero.primaryCta.href.startsWith('http://')
                ? hero.primaryCta.href
                : buildAppUrl(hero.primaryCta.href)
            }
          >
            <Button size="lg" className={`w-full sm:w-auto ${MARKETING_CTA_CLASS}`}>
              {hero.primaryCta.label}
            </Button>
          </Link>
          {hero.secondaryCta ? (
            <Link
              href={
                hero.secondaryCta.href.startsWith('#')
                  ? hero.secondaryCta.href
                  : buildAppUrl(hero.secondaryCta.href)
              }
            >
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                {hero.secondaryCta.label}
              </Button>
            </Link>
          ) : null}
        </div>

        {hero.note ? <p className="text-sm break-keep text-muted-foreground">{hero.note}</p> : null}
      </div>
    </section>
  )
}
