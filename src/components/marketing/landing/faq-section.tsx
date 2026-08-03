import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import type { DeckLandingFaqItem } from '@/lib/marketing/types'

export function FaqSection({ faq }: { faq: DeckLandingFaqItem[] }) {
  if (faq.length === 0) return null

  return (
    <section className="border-t px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <h2 className="mb-8 text-center text-2xl font-bold break-keep sm:text-3xl">
          자주 묻는 질문
        </h2>
        <Accordion type="single" collapsible className="w-full">
          {faq.map((item, index) => (
            <AccordionItem key={item.question} value={`faq-${index}`}>
              <AccordionTrigger className="text-base break-keep">{item.question}</AccordionTrigger>
              <AccordionContent className="break-keep text-muted-foreground">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
