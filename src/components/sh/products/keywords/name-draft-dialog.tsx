'use client'

// 상품명(검색용)·검색어 AI 초안 다이얼로그 — Phase 5.
//
// 서버(POST /api/sh/products/<productId>/name-draft)가 후보를 만들어 내려주면
// 이 다이얼로그는 그대로 보여줄 뿐이다. 위반이 있어도 후보를 버리지 않는다 —
// 사용자가 위반 배지를 보고 직접 판단해서 적용하거나 무시한다.
//
// "적용"은 카드의 로컬 폼 state 만 바꾼다. 저장은 카드의 기존 저장 버튼(+변경 사유 게이트)이
// 그대로 맡는다 — 여기서 자동 저장하면 사유 게이트를 우회하게 된다.

import { useEffect, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { normalizeKeyword } from '@/lib/sh/keyword-normalize'
import type { Violation, ViolationSeverity } from '@/lib/sh/keyword-validate'
import { cn } from '@/lib/utils'

// name-validation-panel.tsx 의 관례를 그대로 따른다 — 같은 severity 는 같은 색·아이콘이어야 한다.
const SEVERITY_ICON: Record<ViolationSeverity, typeof AlertCircle> = {
  ERROR: AlertCircle,
  WARN: AlertTriangle,
  INFO: Info,
}

const SEVERITY_CLASS: Record<ViolationSeverity, string> = {
  ERROR: 'text-destructive',
  WARN: 'text-amber-600 dark:text-amber-400',
  INFO: 'text-muted-foreground',
}

type Candidate = { value: string; violations: Violation[] }

type DraftResponse = {
  names: Candidate[]
  keywords: Candidate[]
  unavailable?: boolean
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: string
  channelId: string
  /** 카드에 이미 담긴 검색어 — normalizeKeyword 기준으로 겹치는 후보를 숨긴다. */
  existingKeywords: string[]
  onApplyName: (name: string) => void
  onAddKeyword: (keyword: string) => void
}

export function NameDraftDialog({
  open,
  onOpenChange,
  productId,
  channelId,
  existingKeywords,
  onApplyName,
  onAddKeyword,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [names, setNames] = useState<Candidate[]>([])
  const [keywords, setKeywords] = useState<Candidate[]>([])

  // 열릴 때마다 새로 호출한다 — 상품명이 그 사이 바뀌었을 수 있어 캐시하지 않는다.
  useEffect(() => {
    if (!open) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setUnavailable(false)
      setNames([])
      setKeywords([])
      try {
        const res = await fetch(`/api/sh/products/${productId}/name-draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelId }),
        })
        if (!res.ok) throw new Error('요청 실패')
        const data: DraftResponse = await res.json()
        if (cancelled) return
        if (data.unavailable) {
          setUnavailable(true)
          return
        }
        setNames(data.names ?? [])
        setKeywords(data.keywords ?? [])
      } catch {
        // 부가 기능이다 — 네트워크 실패도 조용히 같은 안내로 흡수한다. 에러 토스트는 띄우지 않는다.
        if (!cancelled) setUnavailable(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [open, productId, channelId])

  const existingKeys = new Set(existingKeywords.map((k) => normalizeKeyword(k)))
  const freshKeywords = keywords.filter((c) => !existingKeys.has(normalizeKeyword(c.value)))

  return (
    <TooltipProvider delayDuration={200}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              AI 초안
            </DialogTitle>
            <DialogDescription>
              상품 정보를 바탕으로 만든 초안입니다. 위반이 있어도 그대로 보여드리니 확인 후 적용해
              주세요.
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              초안을 만드는 중입니다…
            </div>
          )}

          {!loading && unavailable && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              AI 초안을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.
            </p>
          )}

          {!loading && !unavailable && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h4 className="text-sm font-medium">상품명(검색용) 후보</h4>
                {names.length === 0 ? (
                  <p className="text-xs text-muted-foreground">후보가 없습니다.</p>
                ) : (
                  <ul className="space-y-2">
                    {names.map((c, i) => (
                      <li
                        key={`${c.value}-${i}`}
                        className="flex items-start justify-between gap-2 rounded-md border p-2"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm break-words">{c.value}</p>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{c.value.length}자</span>
                            {c.violations.length === 0 ? (
                              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                검사 통과
                              </span>
                            ) : (
                              <span className="flex flex-wrap items-center gap-1.5">
                                {c.violations.map((v, vi) => {
                                  const Icon = SEVERITY_ICON[v.severity]
                                  return (
                                    <Tooltip key={`${v.code}-${vi}`}>
                                      <TooltipTrigger asChild>
                                        <span
                                          className={cn(
                                            'flex items-center gap-0.5',
                                            SEVERITY_CLASS[v.severity]
                                          )}
                                        >
                                          <Icon className="h-3 w-3" aria-hidden="true" />
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-xs">
                                        {v.message}
                                      </TooltipContent>
                                    </Tooltip>
                                  )
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() => {
                            onApplyName(c.value)
                            onOpenChange(false)
                          }}
                        >
                          적용
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium">AI 초안 검색어</h4>
                {freshKeywords.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {keywords.length === 0 ? '후보가 없습니다.' : '이미 담긴 검색어뿐입니다.'}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {freshKeywords.map((c, i) => {
                      const severity = c.violations[0]?.severity ?? null
                      const summary = c.violations.map((v) => v.message).join(' / ')
                      const chip = (
                        <Badge
                          key={`${c.value}-${i}`}
                          variant="outline"
                          role="button"
                          tabIndex={0}
                          onClick={() => onAddKeyword(c.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              onAddKeyword(c.value)
                            }
                          }}
                          className={cn(
                            'cursor-pointer gap-1 text-sm font-normal',
                            severity && SEVERITY_CLASS[severity]
                          )}
                        >
                          {severity &&
                            (() => {
                              const Icon = SEVERITY_ICON[severity]
                              return <Icon className="h-3 w-3" aria-hidden="true" />
                            })()}
                          {c.value}
                        </Badge>
                      )
                      return summary ? (
                        <Tooltip key={`${c.value}-${i}`}>
                          <TooltipTrigger asChild>{chip}</TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            {summary}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        chip
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}
