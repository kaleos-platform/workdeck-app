'use client'

import { useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, Info, Plus, Sparkles, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DEFAULT_KEYWORD_RULES, type KeywordRuleSet } from '@/lib/sh/keyword-rules'
import { validateKeywords, type Violation, type ViolationSeverity } from '@/lib/sh/keyword-validate'
import { cn } from '@/lib/utils'

// 저장 스키마(schemas.ts)와 같은 하드 상한. rules.maxKeywords(쿠팡 20)는 "권장"이라
// 여기서 입력을 막지 않는다 — 21~30개를 이미 보유한 리스팅이 존재한다.
const MAX_KEYWORDS = 30

const SEVERITY_RANK: Record<ViolationSeverity, number> = { INFO: 0, WARN: 1, ERROR: 2 }

const SEVERITY_CHIP: Record<ViolationSeverity, string> = {
  ERROR: 'border-destructive/50 bg-destructive/10 text-destructive',
  WARN: 'border-amber-500/50 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
  INFO: 'border-sky-500/50 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400',
}

const SEVERITY_ICON = {
  ERROR: AlertCircle,
  WARN: AlertTriangle,
  INFO: Info,
} as const

const SEVERITY_LABEL: Record<ViolationSeverity, string> = {
  ERROR: '오류',
  WARN: '경고',
  INFO: '안내',
}

type Props = {
  value: string[]
  onChange: (next: string[]) => void
  suggestions?: string[]
  placeholder?: string
  /** 검증 기준이 되는 검색용 상품명 (§10 상품명 중복 판정). 없으면 상품명 관련 검증은 건너뛴다. */
  productName?: string
  categoryNames?: string[]
  optionNames?: string[]
  /** 미지정 시 쿠팡 기본 규칙 */
  rules?: KeywordRuleSet
  /** "규칙 위반 정리" 결과 반영. 미지정 시 onChange 로 적용한다. */
  onCleanup?: (cleaned: string[]) => void
  /** true 면 칩·글자수·위반 배지는 그대로 보여주되 편집(삭제·추가·정리·추천)은 막는다. */
  readOnly?: boolean
}

export function KeywordEditor({
  value,
  onChange,
  suggestions = [],
  placeholder,
  productName,
  categoryNames,
  optionNames,
  rules,
  onCleanup,
  readOnly = false,
}: Props) {
  const [draft, setDraft] = useState('')

  const activeRules = rules ?? DEFAULT_KEYWORD_RULES

  const normalized = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value])

  const validation = useMemo(
    () =>
      validateKeywords({
        keywords: value,
        productName: productName ?? '',
        categoryNames,
        optionNames,
        rules: activeRules,
      }),
    [value, productName, categoryNames, optionNames, activeRules]
  )

  // 상품명 길이·위반은 상품명 입력란 아래의 NameValidationPanel 이 담당한다.
  // productName 은 여기서도 §10 Rule 1(검색어가 상품명과 중복) 판정에 계속 쓰인다.

  /** 칩 index → 위반 목록 */
  const violationsByIndex = useMemo(() => {
    const map = new Map<number, Violation[]>()
    for (const v of validation.violations) {
      if (v.keywordIndex === null) continue
      const bucket = map.get(v.keywordIndex)
      if (bucket) bucket.push(v)
      else map.set(v.keywordIndex, [v])
    }
    return map
  }, [validation])

  function parseKeywords(raw: string) {
    return raw
      .split(/[,\n]/)
      .map((token) => token.trim())
      .filter(Boolean)
  }

  function addMany(raw: string) {
    const incoming = parseKeywords(raw)
    if (incoming.length === 0) return

    const next = [...value]
    const seen = new Set(normalized)

    for (const keyword of incoming) {
      if (seen.has(keyword.toLowerCase())) continue
      if (next.length >= MAX_KEYWORDS) break
      next.push(keyword)
      seen.add(keyword.toLowerCase())
    }

    if (next.length !== value.length) {
      onChange(next)
    }
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  function applyCleanup() {
    const cleaned = validation.cleaned
    if (onCleanup) onCleanup(cleaned)
    else onChange(cleaned)
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // 한글 등 IME 조합 중인 Enter는 무시 (조합 확정용)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (draft.trim()) {
        addMany(draft)
        setDraft('')
      }
    } else if (e.key === 'Backspace' && draft.length === 0 && value.length > 0) {
      remove(value.length - 1)
    }
  }

  function onInputPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text')
    if (!/[,\n]/.test(pasted)) return

    e.preventDefault()
    addMany(pasted)
    setDraft('')
  }

  const freshSuggestions = suggestions.filter((s) => !normalized.has(s.toLowerCase())).slice(0, 8)
  const atMax = value.length >= MAX_KEYWORDS
  const filledCount = value.filter((v) => v.trim().length > 0).length
  const overRuleLimit = filledCount > activeRules.maxKeywords
  const violationCount = validation.violations.length
  // "정리" 는 위반 검색어를 통째로 지운다. maxKeywords 초과분도 위반이라 몇 개가
  // 사라지는지 반드시 라벨에 드러낸다.
  // cleaned 는 빈 문자열 항목도 함께 떨어뜨리므로 filledCount 가 아니라 value.length 로 센다
  // (덜 세면 라벨이 실제 삭제 개수보다 작아진다).
  const removeCount = Math.max(0, value.length - validation.cleaned.length)

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-2">
        {/* 요약 줄 */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-live="polite">
          <span
            className={cn(
              overRuleLimit
                ? 'font-medium text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground'
            )}
          >
            검색어 {filledCount}/{activeRules.maxKeywords}
          </span>
          {violationCount > 0 && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                위반 {violationCount}
              </span>
            </>
          )}
          {violationCount > 0 && !readOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={applyCleanup}
              className="ml-auto h-6 gap-1 px-2 text-xs"
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              규칙 위반 정리{removeCount > 0 ? ` (${removeCount}개 제거)` : ''}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 rounded-md border bg-background px-2 py-2 focus-within:border-primary/50">
          {value.map((v, idx) => {
            const hits = violationsByIndex.get(idx) ?? []
            const severity = hits.reduce<ViolationSeverity | null>(
              (acc, hit) =>
                acc === null || SEVERITY_RANK[hit.severity] > SEVERITY_RANK[acc]
                  ? hit.severity
                  : acc,
              null
            )
            const SeverityIcon = severity ? SEVERITY_ICON[severity] : null
            const summary = hits.map((h) => h.message).join(' / ')

            return (
              <Badge
                key={`${v}-${idx}`}
                variant={severity ? 'outline' : 'secondary'}
                className={cn(
                  'gap-1 pr-1.5 pl-2 text-sm font-normal',
                  severity && SEVERITY_CHIP[severity]
                )}
              >
                {severity && SeverityIcon && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={`검색어 ${v} ${SEVERITY_LABEL[severity]}: ${summary}`}
                        className="rounded-sm p-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <SeverityIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <ul className="space-y-1">
                        {hits.map((hit, hitIdx) => (
                          <li key={`${hit.code}-${hitIdx}`}>
                            {hit.message}
                            {hit.conflictWith ? ` (충돌: ${hit.conflictWith})` : ''}
                          </li>
                        ))}
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                )}
                <span>{v}</span>
                {/* readOnly 일 때는 disabled 가 아니라 아예 렌더하지 않는다 — 회색 X 는
                    "지울 수 있는데 막혔다"로 읽혀 거짓 어포던스가 된다. */}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    aria-label={`키워드 ${v} 제거`}
                    className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            )
          })}
          {!readOnly && (
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onInputKeyDown}
              onPaste={onInputPaste}
              placeholder={
                atMax ? `최대 ${MAX_KEYWORDS}개` : (placeholder ?? '키워드 입력 후 Enter')
              }
              disabled={atMax}
              className="h-7 min-w-[140px] flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {value.length} / {MAX_KEYWORDS}
          {!readOnly && ' · Enter 또는 ,(쉼표)로 추가, Backspace로 마지막 삭제'}
        </p>
        {freshSuggestions.length > 0 && !readOnly && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-muted-foreground">추천:</span>
            {freshSuggestions.map((s) => (
              <Button
                key={s}
                type="button"
                variant="outline"
                size="sm"
                disabled={atMax}
                onClick={() => addMany(s)}
                className="h-6 gap-1 px-2 text-xs"
              >
                <Plus className="h-3 w-3" />
                {s}
              </Button>
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
