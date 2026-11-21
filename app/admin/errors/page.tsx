import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/admin/auth'
import { ErrorsTable, type ErrorRow } from '@/components/admin/errors-table'
import { isSentryApiConfigured, listComments, listIssues } from '@/lib/sentry/api'
import { parseAutofixState, type AutofixKind, type AutofixState } from '@/lib/sentry/autofix-status'

const SERVICES = ['all', 'web', 'worker'] as const
const KINDS: AutofixKind[] = ['none', 'request', 'running', 'pr', 'analysis', 'failed', 'skip']

export default async function AdminErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; status?: string }>
}) {
  const auth = await requireOperator()
  if (!auth.ok) notFound()

  const header = (
    <div>
      <h1 className="text-lg font-semibold">오류</h1>
      <p className="text-sm text-muted-foreground">
        운영 미해결 오류 · 최근 14일 · 영향 사용자 많은 순 25건
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
  const status = KINDS.find((k) => k === sp.status) ?? 'all'

  let rows: ErrorRow[]
  let counts: { web: number; worker: number }
  let lastActivity: { at: string; shortId: string; kind: AutofixKind } | null = null
  try {
    const [web, worker] = await Promise.all([listIssues('web'), listIssues('worker')])
    counts = { web: web.length, worker: worker.length }
    const merged =
      service === 'web'
        ? web
        : service === 'worker'
          ? worker
          : [...web, ...worker]
              .sort((a, b) => b.userCount - a.userCount || b.count - a.count)
              .slice(0, 25)
    const states: AutofixState[] = await Promise.all(
      merged.map(async (i) =>
        i.numComments > 0 ? parseAutofixState(await listComments(i.id)) : { kind: 'none' as const }
      )
    )
    rows = merged.map((i, idx) => ({ ...i, autofix: states[idx] }))
    for (const r of rows) {
      const at = r.autofix.at
      if (at && (!lastActivity || Date.parse(at) > Date.parse(lastActivity.at))) {
        lastActivity = { at, shortId: r.shortId, kind: r.autofix.kind }
      }
    }
    if (status !== 'all') rows = rows.filter((r) => r.autofix.kind === status)
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
        status={status}
        counts={counts}
        lastActivity={lastActivity}
      />
    </div>
  )
}
