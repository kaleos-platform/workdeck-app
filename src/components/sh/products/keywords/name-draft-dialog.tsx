'use client'

// 상품명(검색용)·검색어 AI 초안 다이얼로그 — Phase 5.
//
// 서버(POST /api/sh/products/<productId>/name-draft)가 후보를 만들어 내려주면
// 이 다이얼로그는 그대로 보여줄 뿐이다. 위반이 있어도 후보를 버리지 않는다 —
// 사용자가 위반 배지를 보고 직접 판단해서 적용하거나 무시한다.
//
// "적용"은 카드의 로컬 폼 state 만 바꾼다. 저장은 카드의 기존 저장 버튼(+변경 사유 게이트)이
// 그대로 맡는다 — 여기서 자동 저장하면 사유 게이트를 우회하게 된다.

import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Info,
  Loader2,
  Sparkles,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  /** 카드에 이미 담긴 검색어 — 적용된 칩을 구분하는 데 쓴다(더 이상 목록에서 숨기지 않는다). */
  existingKeywords: string[]
  /** 카드의 현재 상품명(검색용) — 어느 후보가 지금 적용된 상태인지 판정하는 데 쓴다. */
  currentSearchName: string
  onApplyName: (name: string) => void
  onAddKeyword: (keyword: string) => void
}

export function NameDraftDialog({
  open,
  onOpenChange,
  productId,
  channelId,
  existingKeywords,
  currentSearchName,
  onApplyName,
  onAddKeyword,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [names, setNames] = useState<Candidate[]>([])
  const [keywords, setKeywords] = useState<Candidate[]>([])
  // 다이얼로그를 연 시점의 검색어 개수 — 적용 상태 바의 "전/후" 비교 기준. open 이 true 로
  // 바뀌는 순간에만 한 번 스냅샷을 잡는다(의존성은 open 뿐 — existingKeywords 변화로는 재스냅샷하지 않는다).
  const openedKeywordCountRef = useRef(existingKeywords.length)
  const existingKeywordsRef = useRef(existingKeywords)
  existingKeywordsRef.current = existingKeywords

  useEffect(() => {
    if (open) openedKeywordCountRef.current = existingKeywordsRef.current.length
  }, [open])

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
  const normalizedCurrentName = currentSearchName.trim()
  const keywordDelta = existingKeywords.length - openedKeywordCountRef.current

  return (
    <TooltipProvider delayDuration={200}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* 폭: 화면의 92% 안에서 최대 56rem. 상품명 후보가 40~70자라 lg(32rem)에서는
              한 줄이 서너 줄로 접혀 비교가 안 된다.
              구조: 세로 flex + overflow-hidden 으로 두고 본문만 스크롤시킨다. footer 를
              sticky + 음수 마진으로 띄우면 요소 폭이 컨테이너보다 커져 가로 스크롤이 생긴다. */}
        <DialogContent className="flex max-h-[85vh] w-[min(92vw,56rem)] flex-col gap-0 overflow-hidden sm:max-w-[56rem]">
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

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
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
                  {/* 아래 검색어 위반은 "지금 등록된 상품명" 기준으로 계산된 것이다(§10 중복).
                    상품명 후보를 적용하면 그 기준이 바뀌므로 사용자에게 미리 알린다. */}
                  <p className="text-xs text-muted-foreground">
                    상품명을 적용하면 검색어 중복 검사 기준이 새 이름으로 바뀝니다. 필요하면
                    검색어도 다시 확인해 주세요.
                  </p>
                  {names.length === 0 ? (
                    <p className="text-xs text-muted-foreground">후보가 없습니다.</p>
                  ) : (
                    <ul className="space-y-2">
                      {/* 현재 상품명 — 후보와 같은 줄 형식으로 두어 위아래로 눈으로 비교할 수 있게 한다.
                        기준선일 뿐 후보가 아니므로 배경을 구분하고 적용 버튼 자리는 비운다. */}
                      <li className="flex items-start justify-between gap-2 rounded-md border bg-muted/40 p-2">
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm break-words">
                            {normalizedCurrentName || '(상품명 없음)'}
                          </p>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{normalizedCurrentName.length}자</span>
                          </div>
                        </div>
                        <span className="shrink-0 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                          현재
                        </span>
                      </li>
                      {names.map((c, i) => {
                        const isApplied = c.value.trim() === normalizedCurrentName
                        const lengthDelta = normalizedCurrentName
                          ? c.value.length - normalizedCurrentName.length
                          : 0
                        return (
                          <li
                            key={`${c.value}-${i}`}
                            className="flex items-start justify-between gap-2 rounded-md border p-2"
                          >
                            <div className="min-w-0 space-y-1">
                              <p className="text-sm break-words">{c.value}</p>
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span>
                                  {c.value.length}자
                                  {/* 증감에 색을 입히지 않는다 — 길어지는 게 좋은지 나쁜지는
                                    목표 구간(채널 규칙)에 달렸다. 현재 35자면 길어지는 쪽이
                                    맞는 방향인데 경고색을 칠하면 정반대를 가리킨다.
                                    길이 품질 판단은 아래 위반 배지가 이미 한다. */}
                                  {lengthDelta !== 0 && (
                                    <span>
                                      {' '}
                                      ({lengthDelta > 0 ? '+' : ''}
                                      {lengthDelta})
                                    </span>
                                  )}
                                </span>
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
                            {isApplied ? (
                              <span className="flex shrink-0 items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                적용됨
                              </span>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="shrink-0"
                                onClick={() => onApplyName(c.value)}
                              >
                                적용
                              </Button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium">AI 추천 키워드</h4>

                  {/* 지금 카드에 실제로 담긴 값 — 클릭해도 아무 일도 일어나지 않는다. AI 추천과
                    시각적으로 확실히 구분해 "이게 실제 등록값" 임을 보여준다. */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      현재 키워드 ({existingKeywords.length})
                    </p>
                    {existingKeywords.length === 0 ? (
                      <p className="text-xs text-muted-foreground">아직 없습니다.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {existingKeywords.map((k, i) => (
                          <Badge
                            key={`${k}-${i}`}
                            variant="secondary"
                            className="cursor-default gap-1 text-sm font-normal"
                          >
                            {k}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      AI 추천 ({keywords.length})
                    </p>
                    {keywords.length === 0 ? (
                      <p className="text-xs text-muted-foreground">후보가 없습니다.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {keywords.map((c, i) => {
                          const added = existingKeys.has(normalizeKeyword(c.value))
                          const severity = c.violations[0]?.severity ?? null
                          const violationSummary = c.violations.map((v) => v.message).join(' / ')
                          const summary = added
                            ? ['이미 담긴 검색어입니다.', violationSummary]
                                .filter(Boolean)
                                .join(' ')
                            : violationSummary
                          const chip = (
                            <Badge
                              key={`${c.value}-${i}`}
                              variant="outline"
                              role="button"
                              aria-disabled={added}
                              tabIndex={added ? -1 : 0}
                              onClick={() => {
                                if (added) return
                                onAddKeyword(c.value)
                              }}
                              onKeyDown={(e) => {
                                if (added) return
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  onAddKeyword(c.value)
                                }
                              }}
                              className={cn(
                                'gap-1 text-sm font-normal',
                                added ? 'cursor-default opacity-70' : 'cursor-pointer',
                                !added && severity && SEVERITY_CLASS[severity]
                              )}
                            >
                              {added ? (
                                <Check className="h-3 w-3" aria-hidden="true" />
                              ) : (
                                severity &&
                                (() => {
                                  const Icon = SEVERITY_ICON[severity]
                                  return <Icon className="h-3 w-3" aria-hidden="true" />
                                })()
                              )}
                              {c.value}
                              {!added && <span aria-hidden="true">+</span>}
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
              </div>
            )}
          </div>

          {!loading && !unavailable && (
            <DialogFooter className="flex-col items-stretch gap-2 border-t bg-background pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-0.5 text-xs text-muted-foreground">
                <p className="flex min-w-0 items-center gap-1">
                  <span className="shrink-0 font-medium text-foreground">현재 상품명</span>
                  <span className="truncate">
                    {normalizedCurrentName || '(비어 있음)'} ({normalizedCurrentName.length}자)
                  </span>
                </p>
                <p>
                  <span className="font-medium text-foreground">검색어</span>{' '}
                  {openedKeywordCountRef.current}개 → {existingKeywords.length}개
                  {keywordDelta !== 0 && (
                    <span
                      className={cn(
                        'ml-1',
                        keywordDelta > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-destructive'
                      )}
                    >
                      ({keywordDelta > 0 ? '+' : ''}
                      {keywordDelta})
                    </span>
                  )}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => onOpenChange(false)}
              >
                닫기
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}
