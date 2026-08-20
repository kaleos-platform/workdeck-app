'use client'

// §22 STEP 05 — 상품명 정리.
//
// 체크리스트는 `validateProductName` 결과를 그대로 쓴다. 검증 로직을 여기서 다시 구현하지 않는다.
// 가이드가 지운다고 한 7개 항목 중 '의미 없는 수식어'·'사실과 다른 표현'은 기계로 판정할 수 없어
// 사람이 확인하는 행으로 따로 둔다(자동 검증에 섞으면 검사한 척이 된다).

import { useMemo } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { fixForViolation } from '@/lib/sh/keyword-fix'
import type { KeywordRuleSet } from '@/lib/sh/keyword-rules'
import {
  validateProductName,
  type Violation,
  type ViolationSeverity,
} from '@/lib/sh/keyword-validate'
import { cn } from '@/lib/utils'

import { NameLengthGauge } from './name-length-gauge'

const SEVERITY_ICON = { ERROR: AlertCircle, WARN: AlertTriangle, INFO: Info } as const

const SEVERITY_STYLE: Record<ViolationSeverity, string> = {
  ERROR: 'text-destructive',
  WARN: 'text-amber-600 dark:text-amber-400',
  INFO: 'text-sky-600 dark:text-sky-400',
}

const SEVERITY_LABEL: Record<ViolationSeverity, string> = {
  ERROR: '오류',
  WARN: '경고',
  INFO: '안내',
}

/** 사람이 직접 확인해야 하는 §22 STEP05 항목. */
export const MANUAL_CHECKS = [
  { key: 'filler', label: '의미 없는 수식어를 제거했습니다', hint: '예: 초특급, 대박, 강력' },
  {
    key: 'falseClaim',
    label: '사실과 다른 표현이 없습니다',
    hint: '상품에 해당하지 않는 소재·기능·효능 표현',
  },
] as const

export type ManualCheckKey = (typeof MANUAL_CHECKS)[number]['key']

type Props = {
  name: string
  onNameChange: (next: string) => void
  rules: KeywordRuleSet
  manualChecks: Record<ManualCheckKey, boolean>
  onManualCheckChange: (key: ManualCheckKey, checked: boolean) => void
}

export function StepCleanName({
  name,
  onNameChange,
  rules,
  manualChecks,
  onManualCheckChange,
}: Props) {
  const result = useMemo(() => validateProductName(name, rules), [name, rules])

  function fixFor(violation: Violation): (() => void) | null {
    const fixed = fixForViolation(name, violation, rules)
    if (fixed === null) return null
    return () => onNameChange(fixed)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="clean-name">상품명</Label>
        <Textarea
          id="clean-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          rows={2}
        />
        <NameLengthGauge length={name.trim().length} rules={rules} />
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">규칙 체크리스트</h3>
        <div aria-live="polite" className="space-y-2">
          {result.violations.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              자동 검사 항목에서 걸린 내용이 없습니다.
            </div>
          ) : (
            <ul className="space-y-2">
              {result.violations.map((violation, idx) => {
                const Icon = SEVERITY_ICON[violation.severity]
                const fix = fixFor(violation)
                return (
                  <li
                    key={`${violation.code}-${idx}`}
                    className="flex flex-wrap items-start gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <Icon
                      className={cn('mt-0.5 h-4 w-4 shrink-0', SEVERITY_STYLE[violation.severity])}
                      aria-hidden="true"
                    />
                    <span className="sr-only">{SEVERITY_LABEL[violation.severity]}</span>
                    <span className="min-w-0 flex-1 break-keep">{violation.message}</span>
                    {fix && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={fix}
                      >
                        {violation.code === 'NAME_SPECIAL_CHARS'
                          ? '특수문자 제거'
                          : `'${violation.conflictWith}' 제거`}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">직접 확인</h3>
        <p className="text-xs text-muted-foreground">
          자동으로 판정할 수 없는 항목입니다. 상품명을 읽어보고 직접 확인해주세요.
        </p>
        <ul className="space-y-2">
          {MANUAL_CHECKS.map((check) => (
            <li key={check.key} className="flex items-start gap-2 rounded-md border px-3 py-2">
              <Checkbox
                id={`manual-${check.key}`}
                checked={manualChecks[check.key]}
                onCheckedChange={(v) => onManualCheckChange(check.key, v === true)}
                className="mt-0.5"
              />
              <div className="min-w-0">
                <Label htmlFor={`manual-${check.key}`} className="text-sm font-normal">
                  {check.label}
                </Label>
                <p className="text-xs text-muted-foreground">{check.hint}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
