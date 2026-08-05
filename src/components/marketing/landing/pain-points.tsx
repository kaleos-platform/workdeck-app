import { AlertCircle } from 'lucide-react'
import type { DeckLandingPainPoint } from '@/lib/marketing/types'

export function PainPoints({ points }: { points: DeckLandingPainPoint[] }) {
  return (
    <section className="border-t px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <h2 className="mb-10 text-center text-2xl font-bold break-keep sm:text-3xl">
          이런 문제로 시간을 낭비하고 있나요?
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {points.map((point) => (
            <div key={point.title} className="space-y-2 rounded-xl border bg-card p-6">
              <AlertCircle className="h-5 w-5 text-muted-foreground" aria-hidden />
              <h3 className="font-semibold break-keep">{point.title}</h3>
              <p className="text-sm break-keep text-muted-foreground">{point.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
