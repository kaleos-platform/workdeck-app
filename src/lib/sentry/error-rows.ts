import 'server-only'
import type { ErrorRow } from '@/components/admin/errors-table'
import { listComments, listIssues } from '@/lib/sentry/api'
import { deriveStage, parseAutofixState, parseTriage, type AutofixState } from './autofix-status'

const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3 } as const

// 어드민 오류 화면과 digest cron 이 공유하는 행 구성 — 우선순위 → 사용자 → 발생 순 상위 25건
export async function buildErrorRows(
  service: 'all' | 'web' | 'worker'
): Promise<{ rows: ErrorRow[]; counts: { web: number; worker: number } }> {
  const [web, worker] = await Promise.all([listIssues('web'), listIssues('worker')])
  const counts = { web: web.length, worker: worker.length }
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
  const rows = candidates
    .map((i, idx): ErrorRow => {
      const { autofix, triage } = notes[idx]
      return { ...i, autofix, triage, stage: deriveStage(autofix, triage) }
    })
    .sort((a, b) => rank(a) - rank(b) || b.userCount - a.userCount || b.count - a.count)
    .slice(0, 25)
  return { rows, counts }
}
