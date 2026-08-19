'use client'

// 상품명·검색어 변경 게이트 — 가이드 §25(변경 관리) · §26(변경 기록).
//
// 이 다이얼로그는 감사 로그 입력창이 아니라 **억제 장치**다. §25 는 "노출이 조금 줄었다",
// "광고 성과가 며칠 좋지 않다" 같은 이유로 상품명을 자주 바꾸지 말라고 못 박는다.
// 그래서 저장 직전에 한 번 멈춰 세우고, 무엇이 바뀌는지 눈으로 확인시키고, 사유를 고르게 한다.
//
// 열리는 조건은 호출부가 `diffKeywordChange(...).changed` 로 판정한다 — 가격·재고·메모만
// 고친 저장은 여기까지 오지 않는다.

import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'

import type { KeywordChangeReason } from '@/generated/prisma/enums'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { KEYWORD_CHANGE_REASON_LABELS } from '@/lib/sh/keyword-labels'
import { diffKeywordChange, toKeywordList } from '@/lib/sh/keyword-change'
import { cn } from '@/lib/utils'

/** 저장 요청 본문에 그대로 실리는 필드. PATCH 라우트 3곳이 같은 이름을 받는다. */
export type KeywordChangeMeta = {
  changeReason: KeywordChangeReason
  reasonNote?: string
  observeMetric?: string
}

/** §25 "변경하지 않음" — 선택지가 아니라 **되돌아가라는 신호**라 목록으로만 보여준다. */
const NON_REASONS = [
  '노출이 조금 줄었다',
  '광고 성과가 며칠 좋지 않다',
  '경쟁사가 상품명을 변경했다',
  '키워드를 하나 더 발견했다',
]

const REASON_ORDER: KeywordChangeReason[] = [
  'WRONG_MAIN_KEYWORD',
  'UNCLEAR_NAME',
  'POLICY_RISK',
  'NEW_SEARCH_DATA',
  'SPEC_CHANGE',
  'BRAND_MODEL_CHANGE',
  'INITIAL_REGISTRATION',
  'TYPO_FIX',
  'OTHER',
]

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  beforeName: string | null | undefined
  afterName: string | null | undefined
  beforeKeywords: string[]
  afterKeywords: string[]
  /** 저장 진행 중 — 버튼 비활성화 및 스피너 */
  saving?: boolean
  /** 확인 시 호출. 다이얼로그를 닫는 것은 호출부 책임(저장 실패 시 열어둘 수 있어야 한다). */
  onConfirm: (meta: KeywordChangeMeta) => void | Promise<void>
}

export function KeywordChangeDialog({ open, onOpenChange, saving = false, ...rest }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 저장 중에는 닫지 않는다 — 응답 전에 닫히면 결과를 알릴 곳이 사라진다.
        if (saving) return
        onOpenChange(next)
      }}
    >
      {/* 본문은 닫힐 때 언마운트된다 — 사유·메모 입력이 자동으로 초기화되므로
          직전 변경의 사유가 다음 변경에 눌려 들어갈 일이 없다. */}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <KeywordChangeForm {...rest} saving={saving} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

type FormProps = Omit<Props, 'open' | 'onOpenChange' | 'saving'> & {
  saving: boolean
  onCancel: () => void
}

function KeywordChangeForm({
  beforeName,
  afterName,
  beforeKeywords,
  afterKeywords,
  saving,
  onConfirm,
  onCancel,
}: FormProps) {
  const [reason, setReason] = useState<KeywordChangeReason | ''>('')
  const [reasonNote, setReasonNote] = useState('')
  const [observeMetric, setObserveMetric] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const diff = useMemo(
    () =>
      diffKeywordChange({
        beforeName,
        afterName,
        beforeKeywords,
        afterKeywords,
      }),
    [beforeName, afterName, beforeKeywords, afterKeywords]
  )

  const nameTokens = useMemo(
    () => diffTokens(beforeName ?? '', afterName ?? ''),
    [beforeName, afterName]
  )

  const keywordDelta = useMemo(() => {
    const before = toKeywordList(beforeKeywords)
    const after = toKeywordList(afterKeywords)
    const beforeSet = new Set(before)
    const afterSet = new Set(after)
    return {
      added: after.filter((k) => !beforeSet.has(k)),
      removed: before.filter((k) => !afterSet.has(k)),
      kept: after.filter((k) => beforeSet.has(k)),
    }
  }, [beforeKeywords, afterKeywords])

  // 서버 Zod 도 400 으로 막지만, 저장을 한 번 왕복시킨 뒤 거절하는 것보다 여기서 잡는 게 낫다.
  const noteRequired = reason === 'OTHER'
  const noteMissing = noteRequired && reasonNote.trim().length === 0
  const reasonMissing = reason === ''

  async function handleConfirm() {
    setSubmitted(true)
    if (reasonMissing || noteMissing) return
    await onConfirm({
      changeReason: reason,
      reasonNote: reasonNote.trim() || undefined,
      observeMetric: observeMetric.trim() || undefined,
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>상품명·검색어 변경</DialogTitle>
        <DialogDescription>
          변경 내용과 사유가 이력으로 남습니다. 저장 전에 바뀌는 내용을 확인해 주세요.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {diff.multiChange && (
          <Alert className="border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>상품명과 검색어를 동시에 바꾸고 있습니다</AlertTitle>
            <AlertDescription className="text-amber-800 dark:text-amber-300">
              여러 요소를 동시에 변경하면 어떤 변경이 성과에 영향을 줬는지 판별하기 어렵습니다. 한
              번에 하나씩 바꾸면 결과를 읽기 쉬워집니다. 그대로 저장할 수도 있습니다.
            </AlertDescription>
          </Alert>
        )}

        {diff.nameChanged && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">상품명</h3>
            <div className="space-y-1.5 rounded-md border bg-muted/20 p-3 text-sm">
              <div className="flex gap-2">
                <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">기존</span>
                <p className="min-w-0 break-words">
                  {nameTokens.before.length === 0 ? (
                    <span className="text-muted-foreground">(비어 있음)</span>
                  ) : (
                    nameTokens.before.map((t, i) => (
                      <span
                        key={`b-${i}`}
                        className={cn(
                          t.changed &&
                            'rounded bg-destructive/10 px-0.5 text-destructive line-through'
                        )}
                      >
                        {t.text}{' '}
                      </span>
                    ))
                  )}
                </p>
              </div>
              <div className="flex gap-2 border-t pt-1.5">
                <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">변경</span>
                <p className="min-w-0 break-words">
                  {nameTokens.after.length === 0 ? (
                    <span className="text-muted-foreground">(비어 있음)</span>
                  ) : (
                    nameTokens.after.map((t, i) => (
                      <span
                        key={`a-${i}`}
                        className={cn(
                          t.changed &&
                            'rounded bg-emerald-500/15 px-0.5 font-medium text-emerald-700 dark:text-emerald-400'
                        )}
                      >
                        {t.text}{' '}
                      </span>
                    ))
                  )}
                </p>
              </div>
            </div>
          </section>
        )}

        {diff.keywordsChanged && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">
              검색어
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                추가 {keywordDelta.added.length} · 삭제 {keywordDelta.removed.length} · 유지{' '}
                {keywordDelta.kept.length}
              </span>
            </h3>
            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              {keywordDelta.added.length > 0 && (
                <KeywordChipRow label="추가" tone="added" items={keywordDelta.added} />
              )}
              {keywordDelta.removed.length > 0 && (
                <KeywordChipRow label="삭제" tone="removed" items={keywordDelta.removed} />
              )}
              {keywordDelta.added.length === 0 && keywordDelta.removed.length === 0 && (
                <p className="text-sm text-muted-foreground">추가·삭제된 검색어가 없습니다.</p>
              )}
            </div>
          </section>
        )}

        <Accordion type="single" collapsible className="rounded-md border px-3">
          <AccordionItem value="non-reasons" className="border-b-0">
            <AccordionTrigger className="py-2.5 text-sm">
              이런 이유라면 바꾸지 않는 편이 낫습니다
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
                {NON_REASONS.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                검색 노출을 개선할 때는 검색어 → 검색 옵션 → 카테고리 → 상품 정보 → 상품명 순으로
                먼저 확인합니다.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="space-y-1.5">
          <Label htmlFor="keyword-change-reason">
            변경 사유 <span className="text-destructive">*</span>
          </Label>
          <Select value={reason} onValueChange={(v) => setReason(v as KeywordChangeReason)}>
            <SelectTrigger
              id="keyword-change-reason"
              aria-invalid={submitted && reasonMissing}
              aria-describedby={
                submitted && reasonMissing ? 'keyword-change-reason-error' : undefined
              }
            >
              <SelectValue placeholder="사유를 선택하세요" />
            </SelectTrigger>
            <SelectContent>
              {REASON_ORDER.map((key) => (
                <SelectItem key={key} value={key}>
                  {KEYWORD_CHANGE_REASON_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {submitted && reasonMissing && (
            <p id="keyword-change-reason-error" role="alert" className="text-xs text-destructive">
              변경 사유를 선택해 주세요.
            </p>
          )}
        </div>

        {noteRequired && (
          <div className="space-y-1.5">
            <Label htmlFor="keyword-change-note">
              상세 사유 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="keyword-change-note"
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              placeholder="무엇을 왜 바꾸는지 적어주세요"
              rows={2}
              maxLength={1000}
              aria-invalid={submitted && noteMissing}
              aria-describedby={submitted && noteMissing ? 'keyword-change-note-error' : undefined}
            />
            {submitted && noteMissing && (
              <p id="keyword-change-note-error" role="alert" className="text-xs text-destructive">
                기타 사유는 상세 사유가 필요합니다.
              </p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="keyword-change-metric">관찰 지표 (선택)</Label>
          <Input
            id="keyword-change-metric"
            value={observeMetric}
            onChange={(e) => setObserveMetric(e.target.value)}
            placeholder="예: 2주간 검색 유입수·전환율"
            maxLength={200}
            aria-describedby="keyword-change-metric-help"
          />
          <p id="keyword-change-metric-help" className="text-xs text-muted-foreground">
            무엇을 보고 이 변경의 성과를 판단할지 적어두면 다음 변경 때 근거가 됩니다.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          취소
        </Button>
        <Button onClick={handleConfirm} disabled={saving}>
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
          변경 저장
        </Button>
      </DialogFooter>
    </>
  )
}

function KeywordChipRow({
  label,
  tone,
  items,
}: {
  label: string
  tone: 'added' | 'removed'
  items: string[]
}) {
  return (
    <div className="flex flex-wrap items-start gap-1.5">
      <span className="pt-1 text-xs text-muted-foreground">{label}</span>
      {items.map((k) => (
        <span
          key={k}
          className={cn(
            'inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs',
            tone === 'added'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'border-destructive/40 bg-destructive/10 text-destructive line-through'
          )}
        >
          {k}
        </span>
      ))}
    </div>
  )
}

type DiffToken = { text: string; changed: boolean }

/**
 * 상품명 토큰(공백 단위) 비교 — 어느 조각이 바뀌었는지만 표시하면 되므로
 * LCS 대신 "상대편에 같은 토큰이 남아 있는가"를 다중집합으로 본다.
 * 위치가 이동한 토큰은 바뀌지 않은 것으로 취급한다(§26 은 무엇이 달라졌는지만 요구한다).
 */
function diffTokens(before: string, after: string): { before: DiffToken[]; after: DiffToken[] } {
  const b = before.trim().split(/\s+/).filter(Boolean)
  const a = after.trim().split(/\s+/).filter(Boolean)

  const count = (list: string[]) => {
    const m = new Map<string, number>()
    for (const t of list) m.set(t, (m.get(t) ?? 0) + 1)
    return m
  }
  const bCount = count(b)
  const aCount = count(a)

  const mark = (list: string[], other: Map<string, number>) => {
    const remain = new Map(other)
    return list.map<DiffToken>((text) => {
      const left = remain.get(text) ?? 0
      if (left > 0) {
        remain.set(text, left - 1)
        return { text, changed: false }
      }
      return { text, changed: true }
    })
  }

  return { before: mark(b, aCount), after: mark(a, bCount) }
}
