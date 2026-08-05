import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildAppUrl } from '@/lib/domain'
import type { DeckLandingCta, DeckLandingFinalCta } from '@/lib/marketing/types'

interface CtaSectionProps {
  finalCta: DeckLandingFinalCta
  primaryCta: DeckLandingCta
  gradient: string
}

export function CtaSection({ finalCta, primaryCta, gradient }: CtaSectionProps) {
  return (
    <section
      className={`bg-gradient-to-br ${gradient} px-4 py-16 text-white sm:px-6 sm:py-20 lg:px-8`}
    >
      <div className="mx-auto max-w-3xl space-y-6 text-center">
        <h2 className="text-2xl font-bold break-keep sm:text-3xl">{finalCta.headline}</h2>
        {finalCta.subcopy ? (
          <p className="text-lg break-keep text-white/90">{finalCta.subcopy}</p>
        ) : null}
        <Link href={buildAppUrl(primaryCta.href)}>
          <Button size="lg" variant="secondary" className="gap-2">
            {primaryCta.label}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </Link>
      </div>
    </section>
  )
}
