import Image from 'next/image'
import type { DeckLandingScreenshot } from '@/lib/marketing/types'

export function ScreenshotShowcase({ screenshots }: { screenshots: DeckLandingScreenshot[] }) {
  if (screenshots.length === 0) return null

  return (
    <section className="border-t bg-muted/30 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-10">
        {screenshots.map((screenshot) => (
          <figure key={screenshot.src} className="space-y-3">
            <div className="overflow-hidden rounded-xl border shadow-sm">
              <Image
                src={screenshot.src}
                alt={screenshot.alt}
                width={1600}
                height={900}
                className="h-auto w-full"
              />
            </div>
            {screenshot.caption ? (
              <figcaption className="text-center text-sm break-keep text-muted-foreground">
                {screenshot.caption}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    </section>
  )
}
