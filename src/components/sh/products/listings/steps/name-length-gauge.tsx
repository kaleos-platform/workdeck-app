'use client'

// §7 상품명 길이 4구간 게이지 — 구간 값은 전부 KeywordRuleSet 에서 온다(하드코딩 금지).
// 리스팅에서 진입하면 해당 채널의 규칙 오버라이드가 반영된 값이 들어온다.

import type { KeywordRuleSet } from '@/lib/sh/keyword-rules'
import { cn } from '@/lib/utils'

type Band = {
  key: string
  label: string
  /** 구간 상한(문자 수) — **이 값을 포함**한다. 40~70 목표면 target.to = 70. */
  to: number
  bar: string
  text: string
}

function buildBands(rules: KeywordRuleSet): Band[] {
  return [
    {
      key: 'below',
      label: '부족',
      // 목표 구간이 40~70 이면 40 은 **목표**다. 여기 상한을 40 으로 두면 length<=to 매칭에서
      // 40 이 '부족' 에 먼저 걸린다(경계가 두 구간에 겹친다).
      to: Math.max(0, rules.nameTargetMin - 1),
      bar: 'bg-muted-foreground/25',
      text: 'text-muted-foreground',
    },
    {
      key: 'target',
      label: '목표',
      to: rules.nameTargetMax,
      bar: 'bg-emerald-500/70',
      text: 'text-emerald-700 dark:text-emerald-400',
    },
    {
      key: 'soft',
      label: '권장 상한 내',
      to: rules.nameSoftMax,
      bar: 'bg-amber-400/70',
      text: 'text-amber-700 dark:text-amber-400',
    },
    {
      key: 'hard',
      label: '운영 상한 초과 주의',
      to: rules.nameHardMax,
      bar: 'bg-destructive/60',
      text: 'text-destructive',
    },
  ]
}

export function NameLengthGauge({ length, rules }: { length: number; rules: KeywordRuleSet }) {
  const bands = buildBands(rules)
  const total = rules.nameHardMax
  const overHard = length > rules.nameHardMax
  const current = bands.find((b) => length <= b.to) ?? bands[bands.length - 1]
  const label = overHard ? '운영 상한 초과' : current.label
  const percent = Math.min(100, (length / total) * 100)

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
        <span className="font-medium tabular-nums">{length}자</span>
        <span
          className={cn('text-xs font-medium', overHard ? 'text-destructive' : current.text)}
          aria-hidden="true"
        >
          {label}
        </span>
        <span className="text-xs text-muted-foreground">
          목표 {rules.nameTargetMin}~{rules.nameTargetMax}자 · 권장 상한 {rules.nameSoftMax}자 ·
          운영 상한 {rules.nameHardMax}자
        </span>
      </div>

      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={length}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuetext={`${length}자, ${label}. 목표 ${rules.nameTargetMin}~${rules.nameTargetMax}자.`}
      >
        <div className="absolute inset-0 flex" aria-hidden="true">
          {bands.map((band, idx) => {
            const from = idx === 0 ? 0 : bands[idx - 1].to
            return (
              <div
                key={band.key}
                className={cn('h-full opacity-30', band.bar)}
                style={{ width: `${((band.to - from) / total) * 100}%` }}
              />
            )
          })}
        </div>
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-[width] duration-200',
            overHard ? 'bg-destructive' : current.bar
          )}
          style={{ width: `${percent}%` }}
          aria-hidden="true"
        />
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {bands.map((band, idx) => {
          // 상한이 포함이므로 다음 구간은 그 다음 글자부터다 — 0~39 / 40~70 / 71~80 / 81~120.
          const from = idx === 0 ? 0 : bands[idx - 1].to + 1
          return (
            <span key={band.key} className="inline-flex items-center gap-1">
              <span className={cn('h-2 w-2 rounded-sm', band.bar)} aria-hidden="true" />
              {band.label} {from}~{band.to}자
            </span>
          )
        })}
      </div>
    </div>
  )
}
