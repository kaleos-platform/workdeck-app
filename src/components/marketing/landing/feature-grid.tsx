import type { DeckLandingFeature } from '@/lib/marketing/types'
import { getFeatureIcon } from './feature-icons'

interface FeatureGridProps {
  features: DeckLandingFeature[]
  gradient: string
}

export function FeatureGrid({ features, gradient }: FeatureGridProps) {
  return (
    <section className="border-t bg-muted/30 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-10 text-center text-2xl font-bold break-keep sm:text-3xl">주요 기능</h2>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = getFeatureIcon(feature.icon)
            return (
              <div key={feature.title} className="space-y-4">
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br ${gradient}`}
                >
                  <Icon className="h-5 w-5 text-white" aria-hidden />
                </div>
                <div>
                  <h3 className="mb-1.5 font-semibold break-keep">{feature.title}</h3>
                  <p className="text-sm break-keep text-muted-foreground">{feature.description}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
