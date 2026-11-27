import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MARKETING_CTA_CLASS } from '@/components/marketing/cta-class'
import { buildAppUrl } from '@/lib/domain'
import type { DeckLandingCta, DeckLandingFinalCta } from '@/lib/marketing/types'

interface CtaSectionProps {
  finalCta: DeckLandingFinalCta
  primaryCta: DeckLandingCta
}

export function CtaSection({ finalCta, primaryCta }: CtaSectionProps) {
  return (
    <section className="bg-blue-50 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-6 text-center">
        <h2 className="text-2xl font-bold break-keep sm:text-3xl">{finalCta.headline}</h2>
        {finalCta.subcopy ? (
          <p className="text-lg break-keep text-muted-foreground">{finalCta.subcopy}</p>
        ) : null}
        <Link
          href={
            primaryCta.href.startsWith('#') ||
            primaryCta.href.startsWith('https://') ||
            primaryCta.href.startsWith('http://')
              ? primaryCta.href
              : buildAppUrl(primaryCta.href)
          }
        >
          <Button size="lg" className={`gap-2 ${MARKETING_CTA_CLASS}`}>
            {primaryCta.label}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </Link>
      </div>
    </section>
  )
}
