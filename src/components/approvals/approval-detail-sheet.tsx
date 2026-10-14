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
  /** 선택한 Space에서 보는 사람의 역할 — requiredRole=OWNER 액션은 OWNER만 승인 버튼 활성 */
  viewerRole: string | null
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

// 실제 실행될 파라미터 표시 — 평평한 객체는 키-값 목록, 중첩은 들여쓴 JSON.
// 값은 React 텍스트 노드로만 렌더링한다(HTML로 해석하지 않음). 서버가 비밀 값을 미리 가린다.
function isFlatObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => v === null || typeof v !== 'object')
  )
}

function ExpandableText({ text, limit }: { text: string; limit: number }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > limit
  return (
    <>
      {isLong && !expanded ? `${text.slice(0, limit)}…` : text}
      {isLong && (
        <button
          type="button"
          className="ml-1 font-sans text-xs text-primary underline"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '접기' : '전체 보기'}
        </button>
      )}
    </>
  )
}

function ParamsView({ payload }: { payload: unknown }) {
  if (payload == null || (isFlatObject(payload) && Object.keys(payload).length === 0)) {
    return <p className="text-sm text-muted-foreground">파라미터가 없습니다</p>
  }
  if (isFlatObject(payload)) {
    return (
      <dl className="space-y-1 rounded-md border p-3 text-sm">
        {Object.entries(payload).map(([key, v]) => (
          <div key={key} className="flex justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">{key}</dt>
            <dd className="text-right break-all text-foreground">
              <ExpandableText text={v == null ? '-' : String(v)} limit={200} />
            </dd>
          </div>
        ))}
      </dl>
    )
  }
  return (
    <pre className="overflow-x-auto rounded-md border p-3 text-xs break-all whitespace-pre-wrap">
      <ExpandableText text={JSON.stringify(payload, null, 2)} limit={1500} />
    </pre>
  )
}

export function ApprovalDetailSheet({
  action,
  open,
  onOpenChange,
  canDecide,
  viewerRole,
  onDecided,
}: ApprovalDetailSheetProps) {
  const [isDeciding, setIsDeciding] = useState(false)
  const [outcomeNote, setOutcomeNote] = useState<{
    kind: 'executed' | 'failed' | 'conflict' | 'expired'
    message: string
  } | null>(null)

  if (!action) return null

  const beforeEntries = toEntries(action.beforeState)
  const isPending = action.status === 'PENDING'
  // 지출 한도 초과 등 OWNER가 필요한 액션 — 거부는 기본 역할로 가능하므로 승인 버튼만 막는다.
  const needsOwner = action.requiredRole === 'OWNER' && viewerRole !== 'OWNER'

  // 목록 갱신 + 사이드바 배지 갱신(별도 컴포넌트 트리라 커스텀 이벤트로 신호).
  function notifyDecided() {
    onDecided()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('workdeck:approvals-changed'))
    }
  }

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

      const data = await res.json().catch(() => null)
      const outcome = data?.outcome

      if (res.status === 403) {
        toast.error(outcome?.message ?? data?.error ?? '권한이 없습니다.')
        return
      }

      if (outcome?.status === 'EXPIRED') {
        setOutcomeNote({
          kind: 'expired',
          message: outcome.message ?? '승인 유효기간이 지난 액션입니다.',
        })
        toast.error('승인 유효기간이 지났습니다')
        notifyDecided()
        return
      }

      if (res.status === 409 || outcome?.status === 'CONFLICT') {
        setOutcomeNote({ kind: 'conflict', message: '이미 처리되었습니다.' })
        toast.info('이미 처리된 액션입니다')
        notifyDecided()
        return
      }

      // 402 = 구독 만료로 실행 차단. 액션은 PENDING으로 남으므로 목록을 갱신하지 않는다.
      if (outcome?.status === 'BLOCKED') {
        const message = outcome.message ?? '구독이 만료되어 조회만 가능합니다'
        setOutcomeNote({ kind: 'failed', message })
        toast.error(message)
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

      notifyDecided()
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
        disabled={!canDecide || needsOwner || isDeciding || !isPending}
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
            {action.actorLabel} · {SOURCE_LABELS[action.source]}
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
            <ParamsView payload={action.payload} />
          </section>

          {(action.spendKrw != null || action.requiredRole) && (
            <dl className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
              {action.spendKrw != null && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">지출 금액</dt>
                  <dd className="text-foreground">{action.spendKrw.toLocaleString('ko-KR')}원</dd>
                </div>
              )}
              {action.requiredRole && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">승인 필요 역할</dt>
                  <dd className="text-foreground">{action.requiredRole}</dd>
                </div>
              )}
            </dl>
          )}

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
        {canDecide && needsOwner && isPending && (
          <p className="px-4 text-sm text-amber-700">
            OWNER 승인 필요 — 지출 한도를 넘는 액션은 회사 대표 계정(OWNER)만 승인할 수 있습니다.
          </p>
        )}
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

function cnOutcome(kind: 'executed' | 'failed' | 'conflict' | 'expired') {
  const base = 'rounded-md border p-3 text-sm'
  if (kind === 'executed') return `${base} border-emerald-300 bg-emerald-50 text-emerald-700`
  if (kind === 'failed') return `${base} border-destructive/30 bg-destructive/5 text-destructive`
  return `${base} border-amber-300 bg-amber-50 text-amber-700`
}
