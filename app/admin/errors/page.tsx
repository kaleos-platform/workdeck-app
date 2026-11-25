import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/admin/auth'
import { ErrorsTable, type ErrorRow, type Summary } from '@/components/admin/errors-table'
import { isSentryApiConfigured, listComments, listIssues } from '@/lib/sentry/api'
import {
  deriveStage,
  parseAutofixState,
  parseTriage,
  STAGE_LABELS,
  type Stage,
  type AutofixKind,
  type AutofixState,
} from '@/lib/sentry/autofix-status'

const SERVICES = ['all', 'web', 'worker'] as const
const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3 } as const

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
    const [web, worker] = await Promise.all([listIssues('web'), listIssues('worker')])
    counts = { web: web.length, worker: worker.length }
    const candidates = service === 'web' ? web : service === 'worker' ? worker : [...web, ...worker]
    const notes = await Promise.all(
      candidates.map(async (i) => {
        const none = { autofix: { kind: 'none' } as AutofixState, triage: null }
        if (i.numComments <= 0) return none
        try {
          const comments = await listComments(i.id)
          return { autofix: parseAutofixState(comments), triage: parseTriage(comments) }
        } catch {
          // 노트 한 건 조회 실패가 목록 전체를 막지 않게 한다
          return none
        }
      })
    )
    const rank = (r: ErrorRow) => (r.triage ? PRIORITY_RANK[r.triage.p] : 4)
    const all = candidates
      .map((i, idx): ErrorRow => {
        const { autofix, triage } = notes[idx]
        return { ...i, autofix, triage, stage: deriveStage(autofix, triage) }
      })
      .sort((a, b) => rank(a) - rank(b) || b.userCount - a.userCount || b.count - a.count)
      .slice(0, 25)
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
