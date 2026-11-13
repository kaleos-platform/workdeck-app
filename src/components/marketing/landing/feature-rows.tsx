import Image from 'next/image'
import type { DeckLandingFeature } from '@/lib/marketing/types'
import { getFeatureIcon } from './feature-icons'

interface FeatureRowsProps {
  features: DeckLandingFeature[]
  gradient: string
}

/**
 * 기능을 한 행씩 크게 설명한다. 이미지가 있으면 설명과 좌우 교차 배치,
 * 없으면 가운데 정렬 글만 둔다.
 */
export function FeatureRows({ features, gradient }: FeatureRowsProps) {
  return (
    <section className="border-t bg-muted/30 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-14 sm:space-y-16">
        <h2 className="text-center text-2xl font-bold break-keep sm:text-3xl">주요 기능</h2>
        {features.map((feature, index) => {
          const Icon = getFeatureIcon(feature.icon)
          const image = feature.image
          const text = (
            <div className={image ? 'space-y-3' : 'mx-auto max-w-2xl space-y-3 text-center'}>
              <div
                className={`flex items-center gap-2 text-sm font-medium text-muted-foreground ${image ? '' : 'justify-center'}`}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br ${gradient}`}
                >
                  <Icon className="h-4 w-4 text-white" aria-hidden />
                </span>
                {feature.title}
              </div>
              {feature.headline ? (
                <h3 className="text-xl font-bold break-keep sm:text-2xl">{feature.headline}</h3>
              ) : null}
              <p className="break-keep text-muted-foreground">{feature.description}</p>
            </div>
          )

          if (!image) return <div key={feature.title}>{text}</div>

          return (
            <div key={feature.title} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
              <div className={index % 2 === 1 ? 'lg:order-2' : ''}>{text}</div>
              <figure className="overflow-hidden rounded-xl border bg-background shadow-sm">
                <Image
                  src={image.src}
                  alt={image.alt}
                  width={1600}
                  height={1000}
                  className="h-auto w-full"
                />
              </figure>
            </div>
          )
        })}
      </div>
    </section>
  )
}
