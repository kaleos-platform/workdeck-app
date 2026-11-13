import Link from 'next/link'
import { ArrowRightLeft, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DeckLandingMigration } from '@/lib/marketing/types'
import { UtmOnly } from './utm-only'

function isExternal(href: string) {
  return href.startsWith('http')
}

/** 다른 서비스에서 옮겨 오는 방문자용 안내 블록 (utm_source 일치 시에만) */
export function MigrationNotice({ migration }: { migration: DeckLandingMigration }) {
  return (
    <UtmOnly source={migration.utmSource}>
      <section className="px-4 pb-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl space-y-5 rounded-xl border bg-muted/40 p-6 sm:p-8">
          <h2 className="text-xl font-bold break-keep sm:text-2xl">{migration.headline}</h2>
          <ul className="space-y-2">
            {migration.points.map((point) => (
              <li key={point} className="flex gap-2 text-sm break-keep sm:text-base">
                <Check
                  className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400"
                  aria-hidden
                />
                {point}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3 sm:flex-row">
            {migration.ctas.map((cta, i) => (
              <Button key={cta.href} asChild variant={i === 0 ? 'default' : 'outline'}>
                {isExternal(cta.href) ? (
                  <a href={cta.href} target="_blank" rel="noopener noreferrer">
                    {cta.label}
                  </a>
                ) : (
                  <Link href={cta.href}>{cta.label}</Link>
                )}
              </Button>
            ))}
          </div>
        </div>
      </section>
    </UtmOnly>
  )
}

/** 이전 전 서비스 기능 → 이 업무 기능 대응표 (utm_source 일치 시에만) */
export function MigrationComparison({ migration }: { migration: DeckLandingMigration }) {
  const { comparison } = migration
  return (
    <UtmOnly source={migration.utmSource}>
      <section className="border-t px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-4xl space-y-8">
          <h2 className="flex items-center justify-center gap-2 text-center text-2xl font-bold break-keep sm:text-3xl">
            <ArrowRightLeft className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden />
            {comparison.headline}
          </h2>
          <div
            className="overflow-x-auto rounded-xl border"
            tabIndex={0}
            role="region"
            aria-label={comparison.headline}
          >
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  {comparison.columns.map((column) => (
                    <th key={column} scope="col" className="px-3 py-3 font-medium sm:px-4">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map(({ before, after, diff, same }) => (
                  <tr key={before} className="border-t">
                    <td className="px-3 py-3 break-keep text-muted-foreground sm:px-4">{before}</td>
                    <td className="px-3 py-3 break-keep sm:px-4">{after}</td>
                    <td className="px-3 py-3 whitespace-nowrap sm:px-4">
                      <span
                        className={
                          same
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }
                      >
                        {diff}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </UtmOnly>
  )
}
