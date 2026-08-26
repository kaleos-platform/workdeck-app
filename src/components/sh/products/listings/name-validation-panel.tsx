'use client'

// 상품명 입력란 하나에 대응하는 위반 표시 + 원클릭 수정.
//
// KeywordEditor 안이 아니라 각 입력란 아래에 둔다 — 키워드 위반과 상품명 위반이
// 한 배지에 섞이면 무엇을 고쳐야 할지 알 수 없다.

import { useMemo } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { fixForViolation } from '@/lib/sh/keyword-fix'
import { rulesForNameField, type KeywordRuleSet, type NameField } from '@/lib/sh/keyword-rules'
import {
  validateProductName,
  type Violation,
  type ViolationSeverity,
} from '@/lib/sh/keyword-validate'
import { cn } from '@/lib/utils'

import { NameLengthGauge } from './steps/name-length-gauge'

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

const SEVERITY_LABEL: Record<ViolationSeverity, string> = {
  ERROR: '오류',
  WARN: '경고',
  INFO: '안내',
}

type Props = {
  value: string
  onChange: (next: string) => void
  field: NameField
  rules: KeywordRuleSet
  readOnly?: boolean
}

export function NameValidationPanel({ value, onChange, field, rules, readOnly }: Props) {
  const fieldRules = useMemo(() => rulesForNameField(rules, field), [rules, field])
  const result = useMemo(() => validateProductName(value, fieldRules), [value, fieldRules])

  if (!value.trim()) return null

  function fixFor(violation: Violation): (() => void) | null {
    if (readOnly) return null
    const fixed = fixForViolation(value, violation, fieldRules)
    if (fixed === null) return null
    return () => onChange(fixed)
  }

  return (
    <div className="space-y-2">
      <NameLengthGauge length={result.length} rules={fieldRules} />
      {result.violations.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          자동 검사 항목에서 걸린 내용이 없습니다.
        </p>
      ) : (
        <ul className="space-y-1" aria-live="polite">
          {result.violations.map((v, i) => {
            const Icon = SEVERITY_ICON[v.severity]
            const fix = fixFor(v)
            return (
              // 수정 버튼은 메시지 바로 옆 — flex-1 로 밀어내면 넓은 폼에서 화면 끝까지 가서 안 보인다.
              <li
                key={`${v.code}-${i}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
              >
                <span className="flex items-center gap-1.5">
                  <Icon
                    className={cn('h-3.5 w-3.5 shrink-0', SEVERITY_CLASS[v.severity])}
                    aria-hidden="true"
                  />
                  <span className="sr-only">{SEVERITY_LABEL[v.severity]}</span>
                  {v.message}
                </span>
                {fix && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={fix}
                    className="h-6 px-2 text-xs"
                  >
                    {v.conflictWith ? `'${v.conflictWith}' 제거` : '특수문자 제거'}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
