'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCurrentSpace } from '@/hooks/use-current-space'
import type { AgentPendingActionDTO, BulkDecisionResult } from './types'

type Decision = 'approve' | 'reject'

const DECISION_LABELS: Record<Decision, string> = { approve: '승인', reject: '거절' }

const RESULT_LABELS: Record<BulkDecisionResult['status'], string> = {
  ok: '성공',
  forbidden: '건너뜀',
  conflict: '건너뜀',
  not_found: '건너뜀',
  failed: '실패',
}

function resultVariant(status: BulkDecisionResult['status']) {
  if (status === 'ok') return 'default' as const
  if (status === 'failed') return 'destructive' as const
  return 'outline' as const
}

type BulkDecisionDialogProps = {
  decision: Decision | null
  actions: AgentPendingActionDTO[]
  onOpenChange: (open: boolean) => void
  onRunningChange: (running: boolean) => void
  /** 제출 완료 — 목록 갱신·선택 해제는 부모가 한다. */
  onDone: () => void
}

export function BulkDecisionDialog({
  decision,
  actions,
  onOpenChange,
  onRunningChange,
  onDone,
}: BulkDecisionDialogProps) {
  const current = useCurrentSpace()
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<BulkDecisionResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 제출 후 목록이 갱신되며 actions가 비므로, 결과 표시용 요약은 제출 시점 것을 기억한다.
  const [summaries, setSummaries] = useState<Record<string, string>>({})

  const open = decision !== null
  const label = decision ? DECISION_LABELS[decision] : ''
  // 승인 대상은 각 action.spaceId — 모두 현재 Space일 때만 이름을 보여 준다(approval-detail-sheet와 같은 규칙).
  const spaceName =
    current && actions.length > 0 && actions.every((a) => a.spaceId === current.id)
      ? current.name
      : null

  // 지출 건은 일괄 승인에서 제외(서버도 forbidden 처리) — 한 건씩 확인하며 승인한다. 거절은 모두 대상.
  const isSpend = (a: AgentPendingActionDTO) => a.spendKrw != null
  const excluded = decision === 'approve' ? actions.filter(isSpend) : []
  const targets = decision === 'approve' ? actions.filter((a) => !isSpend(a)) : actions
  const byType = new Map<string, number>()
  for (const a of targets) byType.set(a.actionType, (byType.get(a.actionType) ?? 0) + 1)

  function setRun(v: boolean) {
    setRunning(v)
    onRunningChange(v)
  }

  function handleOpenChange(next: boolean) {
    if (running) return
    if (!next) {
      setResults(null)
      setError(null)
    }
    onOpenChange(next)
  }

  async function submit() {
    if (!decision || running || targets.length === 0) return
    setRun(true)
    setError(null)
    setSummaries(Object.fromEntries(targets.map((a) => [a.id, a.summary])))
    try {
      const res = await fetch('/api/agent/actions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: decision, actionIds: targets.map((a) => a.id) }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(data?.results)) {
        setError(data?.error ?? '일괄 처리에 실패했습니다')
        return
      }
      setResults(data.results)
    } catch {
      setError('네트워크 오류가 발생했습니다')
    } finally {
      setRun(false)
      // 오류여도 일부가 처리됐을 수 있다 — 목록을 실제 상태로 다시 불러온다.
      onDone()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('workdeck:approvals-changed'))
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!running}>
        <DialogHeader>
          <DialogTitle>{results ? `일괄 ${label} 결과` : `${label} 확인`}</DialogTitle>
          {!results && (
            <DialogDescription>
              {spaceName ? `「${spaceName}」에서 ` : ''}
              {targets.length}건을 {label}합니다.
            </DialogDescription>
          )}
        </DialogHeader>

        {results ? (
          <ul className="max-h-80 space-y-2 overflow-y-auto text-sm" aria-label="처리 결과">
            {results.map((r) => (
              <li key={r.actionId} className="flex items-start gap-2">
                <Badge variant={resultVariant(r.status)} className="shrink-0">
                  {RESULT_LABELS[r.status]}
                </Badge>
                <div className="min-w-0">
                  <p className="truncate font-medium">{summaries[r.actionId] ?? r.actionId}</p>
                  <p className="text-xs break-words text-muted-foreground">{r.message}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1">
              {[...byType].map(([type, count]) => (
                <li key={type} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{type}</span>
                  <span>{count}건</span>
                </li>
              ))}
            </ul>
            <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-muted-foreground">
              {targets.map((a) => (
                <li key={a.id}>{a.summary}</li>
              ))}
              {excluded.map((a) => (
                <li key={a.id}>{a.summary} — 제외(한 건씩 승인)</li>
              ))}
            </ul>
            {excluded.length > 0 && (
              <p className="font-medium">
                지출 {excluded.length}건은 제외됩니다 — 상세 화면에서 한 건씩 승인하세요
              </p>
            )}
            {error && <p className="text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {results ? (
            <Button onClick={() => handleOpenChange(false)}>닫기</Button>
          ) : (
            <>
              <Button variant="outline" disabled={running} onClick={() => handleOpenChange(false)}>
                취소
              </Button>
              <Button
                variant={decision === 'reject' ? 'destructive' : 'default'}
                disabled={running || targets.length === 0}
                onClick={submit}
              >
                {running ? '처리 중...' : `${targets.length}건 ${label}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
