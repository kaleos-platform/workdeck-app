import { CheckCircle2 } from 'lucide-react'

export function TrustStrip({ points }: { points: string[] }) {
  return (
    <section className="border-y bg-muted/40 px-4 py-6 sm:px-6 lg:px-8">
      <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-4 lg:grid-cols-4">
        {points.map((text) => (
          <li key={text} className="flex items-center gap-2 text-sm break-keep">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-600" aria-hidden />
            {text}
          </li>
        ))}
      </ul>
    </section>
  )
}
