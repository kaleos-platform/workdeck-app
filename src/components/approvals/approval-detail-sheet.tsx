'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ExpiryCountdown } from './expiry-countdown'
import { DECK_LABELS, SOURCE_LABELS, STATUS_LABELS, type AgentPendingActionDTO } from './types'

type ApprovalDetailSheetProps = {
  action: AgentPendingActionDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 사전 조회된 사용자의 space 역할 — ADMIN/OWNER만 승인·거부 가능(기본 requiredRole 가정) */
  canDecide: boolean
  onDecided: () => void
}

// object를 키-값 목록으로 평탄화(1depth). 중첩 객체는 JSON 문자열로 표시.
function toEntries(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).map(([key, v]) => {
    if (v === null || v === undefined) return [key, '-']
    if (typeof v === 'object') return [key, JSON.stringify(v)]
    return [key, String(v)]
  })
}

export function ApprovalDetailSheet({
  action,
  open,
  onOpenChange,
  canDecide,
  onDecided,
}: ApprovalDetailSheetProps) {
  const [isDeciding, setIsDeciding] = useState(false)
  const [outcomeNote, setOutcomeNote] = useState<{
    kind: 'executed' | 'failed' | 'conflict'
    message: string
  } | null>(null)

  if (!action) return null

  const payloadEntries = toEntries(action.payload)
  const beforeEntries = toEntries(action.beforeState)
  const isPending = action.status === 'PENDING'

  async function decide(decision: 'approve' | 'reject') {
    if (!action || isDeciding) return
    setIsDeciding(true)
    setOutcomeNote(null)

    try {
      const res = await fetch(`/api/agent/actions/${action.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: decision }),
      })

      if (res.status === 403) {
        toast.error('권한이 없습니다. 승인하려면 ADMIN 권한이 필요합니다.')
        return
      }

      const data = await res.json().catch(() => null)
      const outcome = data?.outcome

      if (res.status === 409 || outcome?.status === 'CONFLICT') {
        setOutcomeNote({ kind: 'conflict', message: '이미 처리되었습니다.' })
        toast.info('이미 처리된 액션입니다')
        onDecided()
        return
      }

      if (!res.ok) {
        toast.error('처리에 실패했습니다')
        return
      }

      if (outcome?.status === 'EXECUTED') {
        setOutcomeNote({
          kind: 'executed',
          message: outcome.result ? JSON.stringify(outcome.result) : '실행이 완료되었습니다.',
        })
        toast.success('승인 후 실행이 완료되었습니다')
      } else if (outcome?.status === 'FAILED') {
        setOutcomeNote({
          kind: 'failed',
          message: outcome.error ?? '실행 중 오류가 발생했습니다.',
        })
        toast.error('실행에 실패했습니다')
      } else if (outcome?.status === 'REJECTED') {
        toast.success('거부되었습니다')
      }

      onDecided()
    } catch {
      toast.error('네트워크 오류가 발생했습니다')
    } finally {
      setIsDeciding(false)
    }
  }

  const decideButtons = (
    <>
      <Button
        variant="outline"
        className="flex-1"
        disabled={!canDecide || isDeciding || !isPending}
        onClick={() => decide('reject')}
      >
        거부
      </Button>
      <Button
        className="flex-1"
        disabled={!canDecide || isDeciding || !isPending}
        onClick={() => decide('approve')}
      >
        승인
      </Button>
    </>
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col sm:max-w-xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{DECK_LABELS[action.deckKey] ?? action.deckKey}</Badge>
            <Badge variant="secondary">{action.actionType}</Badge>
            <Badge>{STATUS_LABELS[action.status]}</Badge>
          </div>
          <SheetTitle>{action.summary}</SheetTitle>
          <SheetDescription>
            요청자 {action.requestedBy} · {SOURCE_LABELS[action.source]}
            {isPending && (
              <>
                {' · '}
                <ExpiryCountdown expiresAt={action.expiresAt} />
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-4">
          {beforeEntries.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">변경 전 (beforeState)</h3>
              <dl className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
                {beforeEntries.map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className="text-right break-all text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-foreground">
              {beforeEntries.length > 0 ? '변경 후 (요청 내용)' : '요청 내용'}
            </h3>
            {payloadEntries.length > 0 ? (
              <dl className="space-y-1 rounded-md border p-3 text-sm">
                {payloadEntries.map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className="text-right break-all text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">파라미터가 없습니다</p>
            )}
          </section>

          {action.status === 'EXECUTED' && action.result != null && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">실행 결과</h3>
              <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs">
                {JSON.stringify(action.result, null, 2)}
              </pre>
            </section>
          )}

          {action.status === 'FAILED' && action.error && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-destructive">실패 사유</h3>
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {action.error}
              </p>
            </section>
          )}

          {outcomeNote && <div className={cnOutcome(outcomeNote.kind)}>{outcomeNote.message}</div>}
        </div>

        <Separator />
        <SheetFooter className="flex-row">
          {canDecide ? (
            decideButtons
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex flex-1 gap-2">{decideButtons}</div>
              </TooltipTrigger>
              <TooltipContent>승인하려면 ADMIN 권한이 필요합니다</TooltipContent>
            </Tooltip>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function cnOutcome(kind: 'executed' | 'failed' | 'conflict') {
  const base = 'rounded-md border p-3 text-sm'
  if (kind === 'executed') return `${base} border-emerald-300 bg-emerald-50 text-emerald-700`
  if (kind === 'failed') return `${base} border-destructive/30 bg-destructive/5 text-destructive`
  return `${base} border-amber-300 bg-amber-50 text-amber-700`
}
