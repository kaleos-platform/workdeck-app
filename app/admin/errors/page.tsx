import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/admin/auth'
import { ErrorsTable, type ErrorRow, type Summary } from '@/components/admin/errors-table'
import { isSentryApiConfigured } from '@/lib/sentry/api'
import { buildErrorRows } from '@/lib/sentry/error-rows'
import { STAGE_LABELS, type Stage, type AutofixKind } from '@/lib/sentry/autofix-status'

const SERVICES = ['all', 'web', 'worker'] as const

export default async function AdminErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; stage?: string; priority?: string }>
}) {
  const auth = await requireOperator()
  if (!auth.ok) notFound()

  const header = (
    <div>
      <h1 className="text-lg font-semibold">오류</h1>
      <p className="text-sm text-muted-foreground">
        운영 미해결 오류 · 최근 14일 · 우선순위 순 25건
      </p>
    </div>
  )

  if (!isSentryApiConfigured()) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p className="text-sm text-muted-foreground">SENTRY_API_TOKEN 이 설정되지 않았습니다</p>
      </div>
    )
  }

  const sp = await searchParams
  const service = SERVICES.find((s) => s === sp.service) ?? 'all'
  const stage = (Object.keys(STAGE_LABELS) as Stage[]).find((k) => k === sp.stage)
  const priority = sp.priority === 'P1' ? 'P1' : undefined

  let rows: ErrorRow[]
  let summary: Summary
  let counts: { web: number; worker: number }
  let lastActivity: { at: string; shortId: string; kind: AutofixKind } | null = null
  try {
    const built = await buildErrorRows(service)
    counts = built.counts
    const all = built.rows
    summary = {
      total: all.length,
      approval: all.filter((r) => r.stage === 'approval').length,
      confirm: all.filter((r) => r.stage === 'confirm').length,
      ignore: all.filter((r) => r.stage === 'ignore-suggested').length,
      p1: all.filter((r) => r.triage?.p === 'P1').length,
    }
    rows = all
    for (const r of rows) {
      const at = r.autofix.at
      if (at && (!lastActivity || Date.parse(at) > Date.parse(lastActivity.at))) {
        lastActivity = { at, shortId: r.shortId, kind: r.autofix.kind }
      }
    }
    if (stage) rows = rows.filter((r) => r.stage === stage)
    if (priority) rows = rows.filter((r) => r.triage?.p === priority)
  } catch {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p className="text-sm text-destructive">Sentry 오류 목록을 불러오지 못했습니다</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <ErrorsTable
        rows={rows}
        service={service}
        stage={stage ?? 'all'}
        priority={priority}
        summary={summary}
        counts={counts}
        lastActivity={lastActivity}
      />
    </div>
  )
}
