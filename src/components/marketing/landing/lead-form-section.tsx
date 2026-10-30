import type { DeckLandingLeadForm, MarketingDeckSlug } from '@/lib/marketing/types'
import { LeadForm } from './lead-form'

export function LeadFormSection({
  leadForm,
  deck,
}: {
  leadForm: DeckLandingLeadForm
  deck: MarketingDeckSlug
}) {
  return (
    <section id="apply" className="scroll-mt-16 border-t px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <h2 className="mb-3 text-center text-2xl font-bold break-keep sm:text-3xl">
          {leadForm.headline}
        </h2>
        <p className="mb-8 text-center break-keep text-muted-foreground">{leadForm.subcopy}</p>
        <LeadForm deck={deck} />
      </div>
    </section>
  )
}
