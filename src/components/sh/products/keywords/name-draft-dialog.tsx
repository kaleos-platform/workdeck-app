'use client'

// 상품명(검색용)·검색어 AI 초안 다이얼로그 — Phase 5.
//
// 서버(POST /api/sh/products/<productId>/name-draft)가 후보를 만들어 내려주면
// 이 다이얼로그는 그대로 보여줄 뿐이다. 결정적 규칙에 걸린 검색어 후보는 서버가 이미 버렸고,
// 남은 위반(안내성)이 있어도 후보를 숨기지 않는다 — 사용자가 배지를 보고 직접 판단한다.
//
// 등록된 검색어에는 진단(reviews)이 붙는다. 제거 권장은 **개별 원클릭**만 제공한다 —
// AI 판정은 틀릴 수 있으므로 일괄 제거는 두지 않는다.
//
// "적용"은 카드의 로컬 폼 state 만 바꾼다. 저장은 카드의 기존 저장 버튼(+변경 사유 게이트)이
// 그대로 맡는다 — 여기서 자동 저장하면 사유 게이트를 우회하게 된다.
//
// fetch 는 이 컴포넌트가 하지 않는다 — 부모가 useNameDraft 훅으로 한 번만 호출해 상품명·
// 키워드 다이얼로그가 결과를 공유한다(같은 호출 하나로 둘 다 만들어지므로). 이 컴포넌트는
// 그 결과를 mode 에 맞는 섹션만 골라 보여주는 프레젠테이션 전용이다.

import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Info,
  Loader2,
  Sparkles,
  X,
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
import type { ViolationSeverity } from '@/lib/sh/keyword-validate'
import { cn } from '@/lib/utils'

import type {
  DraftCandidate,
  DraftKeywordCandidate,
  DraftKeywordReview,
  NameDraftStatus,
} from './use-name-draft'

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

const MODE_TITLE: Record<Mode, string> = {
  name: 'AI 초안 · 상품명',
  keyword: 'AI 초안 · 키워드',
}

type Mode = 'name' | 'keyword'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: Mode
  status: NameDraftStatus
  names: DraftCandidate[]
  keywords: DraftKeywordCandidate[]
  /** 등록된 검색어 진단 — 로드 시점 스냅샷이라 existingKeywords 와 어긋날 수 있다(아래 조인). */
  reviews: DraftKeywordReview[]
  /** 카드에 이미 담긴 검색어 — 적용된 칩을 구분하는 데 쓴다(더 이상 목록에서 숨기지 않는다). */
  existingKeywords: string[]
  /** 카드의 현재 상품명(검색용) — 어느 후보가 지금 적용된 상태인지 판정하는 데 쓴다. */
  currentSearchName: string
  onApplyName: (name: string) => void
  onAddKeyword: (keyword: string) => void
  /** 없으면 제거 버튼을 렌더하지 않는다(읽기 전용 카드). */
  onRemoveKeyword?: (keyword: string) => void
  /** 상품명 단어를 뺀 대안으로 바꾼다. 없으면 교체 버튼을 렌더하지 않는다. */
  onReplaceKeyword?: (keyword: string, next: string) => void
}

export function NameDraftDialog({
  open,
  onOpenChange,
  mode,
  status,
  names,
  keywords,
  reviews,
  existingKeywords,
  currentSearchName,
  onApplyName,
  onAddKeyword,
  onRemoveKeyword,
  onReplaceKeyword,
}: Props) {
  const loading = status === 'idle' || status === 'loading'
  const unavailable = status === 'unavailable'

  // 다이얼로그를 연 시점의 검색어 개수 — 적용 상태 바의 "전/후" 비교 기준. open 이 true 로
  // 바뀌는 순간에만 한 번 스냅샷을 잡는다(의존성은 open 뿐 — existingKeywords 변화로는 재스냅샷하지 않는다).
  // keyword 모드에서만 의미가 있다 — name 모드는 하단 상태 바에 이 값을 쓰지 않는다.
  // ref 가 아니라 state 로 둔다 — 렌더 중에 ref.current 를 읽으면 react-hooks/refs 규칙에 걸린다.
  const [openedKeywordCount, setOpenedKeywordCount] = useState(existingKeywords.length)
  const existingKeywordsRef = useRef(existingKeywords)

  // 렌더 중 ref.current 를 쓰지 않는다(react-hooks/refs 규칙) — effect 로만 최신값을 동기화한다.
  useEffect(() => {
    existingKeywordsRef.current = existingKeywords
  }, [existingKeywords])

  useEffect(() => {
    if (open) setOpenedKeywordCount(existingKeywordsRef.current.length)
  }, [open])

  const existingKeys = new Set(existingKeywords.map((k) => normalizeKeyword(k)))
  const normalizedCurrentName = currentSearchName.trim()
  const keywordDelta = existingKeywords.length - openedKeywordCount

  // 진단은 로드 시점 스냅샷이다. 사용자가 키워드를 지우는 순간 목록과 어긋나므로 재호출 대신
  // 렌더 시점에 정규화 기준으로 조인한다 — 방금 지운 항목의 진단은 자동으로 사라지고, 로드 후
  // 추가된 키워드는 진단 없이 평범한 배지로 그려진다.
  //
  // despaceKeyword 를 쓰면 안 된다 — "밀프렙 용기"와 "밀프렙용기"가 하나의 진단을 공유해
  // 엉뚱한 키워드에 제거를 권하게 된다.
  const reviewByKey = new Map(reviews.map((r) => [normalizeKeyword(r.keyword), r]))
  const shownReviews = existingKeywords.map((k) => reviewByKey.get(normalizeKeyword(k)) ?? null)
  const removeCount = shownReviews.filter((r) => r?.recommendRemove).length
  const suggestCount = shownReviews.filter((r) => r?.suggestion).length

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
              {MODE_TITLE[mode]}
            </DialogTitle>
            <DialogDescription>
              상품 정보를 바탕으로 만든 초안입니다. 위반이 있어도 그대로 보여드리니 확인 후 적용해
              주세요.
            </DialogDescription>
          </DialogHeader>

          {/* max-h 는 보험이다. flex-1+min-h-0 이 정상 동작하면 이 값에 닿기 전에 부모가 높이를
              제한하므로 무해하고, display 가 flex 로 안 잡히는 경우에도 스크롤은 반드시 생긴다.
              이게 없으면 그 상황에서 내용이 잘린 채 스크롤바도 안 보인다. */}
          <div className="max-h-[70vh] min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {/* 후보 생성과 등록 검색어 진단을 한 번의 호출로 만든다 — 예전보다 오래 걸리므로
                  대략적인 소요를 알려준다. */}
                초안과 진단을 함께 만드는 중입니다… (10초 정도 걸립니다)
              </div>
            )}

            {!loading && unavailable && (
              <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                AI 초안을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.
              </p>
            )}

            {!loading && !unavailable && mode === 'name' && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">상품명(검색용) 후보</h4>
                {/* 아래 검색어 위반은 "지금 등록된 상품명" 기준으로 계산된 것이다(§10 중복).
                  상품명 후보를 적용하면 그 기준이 바뀌므로 사용자에게 미리 알린다. */}
                <p className="text-xs text-muted-foreground">
                  상품명을 적용하면 검색어 중복 검사 기준이 새 이름으로 바뀝니다. 필요하면 검색어도
                  다시 확인해 주세요.
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
            )}

            {!loading && !unavailable && mode === 'keyword' && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium">AI 추천 키워드</h4>

                {/* 지금 카드에 실제로 담긴 값. AI 추천과 시각적으로 구분해 "이게 실제 등록값" 임을
                  보여주고, 진단이 붙은 것만 색과 라벨로 드러낸다. 순서는 저장 배열 그대로 둔다 —
                  정리 권장을 위로 끌어올리면 "지금 등록값"이라는 의미가 깨진다. */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    현재 키워드 ({existingKeywords.length})
                    {removeCount > 0 && (
                      <span className="ml-1 text-destructive">· 정리 권장 {removeCount}</span>
                    )}
                    {suggestCount > 0 && (
                      <span className="ml-1 text-amber-600 dark:text-amber-400">
                        · 수정 제안 {suggestCount}
                      </span>
                    )}
                  </p>
                  {existingKeywords.length === 0 ? (
                    <p className="text-xs text-muted-foreground">아직 없습니다.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {existingKeywords.map((k, i) => {
                        const review = shownReviews[i]
                        const flagged = review?.recommendRemove ?? false
                        const suggestion = review?.suggestion
                        const moveToOption = review?.label === 'MOVE_TO_OPTION'
                        // AI 는 KEEP 인데 결정적 규칙이 잡은 경우가 있다(상품명 단어 조합 등).
                        // 그대로 '유지' 라고 쓰면 빨간 배지에 "유지" 가 붙어 앞뒤가 안 맞는다.
                        const badgeLabel =
                          review && review.label === 'KEEP' ? '규칙 위반' : review?.labelText
                        const summary = review
                          ? [
                              review.label === 'KEEP' ? '' : review.labelText,
                              review.reason,
                              ...review.violations.map((v) => v.message),
                            ]
                              .filter(Boolean)
                              .join(' — ')
                          : ''
                        const badge = (
                          <Badge
                            variant={flagged || suggestion ? 'outline' : 'secondary'}
                            className={cn(
                              'cursor-default gap-1 text-sm font-normal',
                              // 검색옵션 이관은 "잘못된 키워드"가 아니라 "여기 있을 값이 아니다" 라
                              // 경고색과 구분한다.
                              moveToOption && 'border-sky-500/60 text-sky-700 dark:text-sky-400',
                              flagged && !moveToOption && 'border-destructive/60 text-destructive',
                              // 제안은 "지울 것"이 아니라 "고칠 것" 이라 경고색과 다른 색을 쓴다.
                              suggestion && 'border-amber-500/60 text-amber-700 dark:text-amber-400'
                            )}
                          >
                            {k}
                            {flagged && <span className="text-xs opacity-80">{badgeLabel}</span>}
                            {/* 제안은 결과를 그대로 보여준다 — 무엇으로 바뀌는지 모르고 누르게
                              하지 않는다. 적용은 사용자가 이 칩 하나에 대해서만 누른다. */}
                            {suggestion && onReplaceKeyword && (
                              <button
                                type="button"
                                aria-label={`${k}를 ${suggestion}로 교체`}
                                className="ml-0.5 rounded-sm font-medium underline-offset-2 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onReplaceKeyword(k, suggestion)
                                }}
                              >
                                → {suggestion}
                              </button>
                            )}
                            {suggestion && !onReplaceKeyword && (
                              <span className="text-xs opacity-80">→ {suggestion}</span>
                            )}
                            {flagged && onRemoveKeyword && (
                              <button
                                type="button"
                                aria-label={`${k} 제거`}
                                className="ml-0.5 rounded-sm opacity-70 hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onRemoveKeyword(k)
                                }}
                              >
                                <X className="h-3 w-3" aria-hidden="true" />
                              </button>
                            )}
                          </Badge>
                        )
                        return summary ? (
                          <Tooltip key={`${k}-${i}`}>
                            <TooltipTrigger asChild>{badge}</TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              {summary}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span key={`${k}-${i}`}>{badge}</span>
                        )
                      })}
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
                        const summary = [
                          added ? '이미 담긴 검색어입니다.' : '',
                          c.reason,
                          violationSummary,
                        ]
                          .filter(Boolean)
                          .join(' — ')
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
                            {/* 생성 축 — 후보가 어느 관점에서 나왔는지 보여준다(축이 한쪽에
                              몰렸는지 눈으로 확인할 수 있다). */}
                            <span className="text-xs text-muted-foreground">{c.intentLabel}</span>
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
            )}
          </div>

          {!loading && !unavailable && (
            <DialogFooter className="flex-col items-stretch gap-2 border-t bg-background pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-0.5 text-xs text-muted-foreground">
                {mode === 'name' && (
                  <p className="flex min-w-0 items-center gap-1">
                    <span className="shrink-0 font-medium text-foreground">현재 상품명</span>
                    <span className="truncate">
                      {normalizedCurrentName || '(비어 있음)'} ({normalizedCurrentName.length}자)
                    </span>
                  </p>
                )}
                {mode === 'keyword' && (
                  <p>
                    <span className="font-medium text-foreground">검색어</span> {openedKeywordCount}
                    개 → {existingKeywords.length}개
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
                )}
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
