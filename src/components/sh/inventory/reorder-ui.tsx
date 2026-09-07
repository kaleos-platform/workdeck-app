'use client'

// 발주 계획 화면 공용 UI 원자 — Panel / KPI / Bar / StepBar / PlanSummaryBar.
// 색상은 semantic CSS 변수를 새로 만들지 않고 레포 기존 관행대로 Tailwind 팔레트 클래스를 쓴다.

import { CheckIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

const QTY = new Intl.NumberFormat('ko-KR')

/** 수량 표기 — 소수는 반올림해 정수로 */
export function fmtQty(n: number): string {
  return QTY.format(Math.round(n))
}

/** 금액 표기 */
export function fmtWon(n: number): string {
  return `₩${QTY.format(Math.round(n))}`
}

/** 부호 있는 퍼센트 (+6.0%) */
export function fmtPctSigned(ratio: number, digits = 1): string {
  const v = ratio * 100
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`
}

type PanelProps = {
  title?: ReactNode
  desc?: ReactNode
  right?: ReactNode
  children: ReactNode
  /** false면 본문 패딩 제거 (표를 가장자리까지 붙일 때) */
  padded?: boolean
  className?: string
}

/** 제목/설명/우측 슬롯을 가진 카드형 섹션 */
export function Panel({ title, desc, right, children, padded = true, className }: PanelProps) {
  return (
    <section className={cn('rounded-lg border bg-card', className)}>
      {(title || right) && (
        <header className="flex items-end justify-between gap-4 border-b px-5 py-3.5">
          <div className="space-y-0.5">
            {title && <h3 className="text-sm font-semibold">{title}</h3>}
            {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
          </div>
          {right}
        </header>
      )}
      <div className={padded ? 'p-5' : undefined}>{children}</div>
    </section>
  )
}

type KpiProps = {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  sub?: ReactNode
  /** 값 글자 크기 */
  size?: 'sm' | 'md' | 'lg'
  className?: string
  valueClassName?: string
}

const KPI_SIZE = {
  sm: 'text-lg',
  md: 'text-xl',
  lg: 'text-2xl',
} as const

/** 라벨 + 큰 숫자 + 단위 + 서브라인 */
export function Kpi({ label, value, unit, sub, size = 'md', className, valueClassName }: KpiProps) {
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <div className="text-xs whitespace-nowrap text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-1 whitespace-nowrap">
        <span
          className={cn(
            'font-mono leading-tight font-semibold tabular-nums',
            KPI_SIZE[size],
            valueClassName
          )}
        >
          {value}
        </span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

type BarProps = {
  value: number
  max: number
  /** 막대 색 Tailwind 클래스 (기본 foreground) */
  tone?: string
  className?: string
}

/** 비중 표시용 얇은 막대 */
export function Bar({ value, max, tone = 'bg-foreground', className }: BarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}>
      <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
    </div>
  )
}

export type WizardStep = {
  id: string
  label: string
  hint?: string
}

type StepBarProps = {
  steps: WizardStep[]
  /** 현재 단계 index */
  current: number
  /** 도달한 최대 단계 index — 이보다 큰 단계는 클릭 불가 */
  reached: number
  onGo: (index: number) => void
}

/** 위저드 단계 표시 + 이동 */
export function StepBar({ steps, current, reached, onGo }: StepBarProps) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border bg-card">
      {steps.map((s, i) => {
        const active = i === current
        const complete = reached > i
        const clickable = i <= reached
        return (
          <button
            key={s.id}
            type="button"
            disabled={!clickable}
            onClick={() => onGo(i)}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2.5 px-3.5 py-3 text-left transition-colors',
              i > 0 && 'border-l',
              active && 'bg-accent',
              clickable ? 'cursor-pointer hover:bg-accent/60' : 'cursor-not-allowed opacity-60'
            )}
          >
            <span
              className={cn(
                'grid h-5.5 w-5.5 flex-none place-items-center rounded-full border border-transparent font-mono text-[11px]',
                active
                  ? 'bg-primary text-primary-foreground'
                  : complete
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              {complete && !active ? <CheckIcon className="h-3 w-3" /> : i + 1}
            </span>
            <span className="grid min-w-0">
              <span
                className={cn(
                  'truncate text-sm font-medium',
                  active ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {s.label}
              </span>
              {s.hint && <span className="truncate text-xs text-muted-foreground">{s.hint}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

type SummaryStat = {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
}

type PlanSummaryBarProps = {
  stats: SummaryStat[]
  /** 우측 액션 영역 */
  actions?: ReactNode
  className?: string
}

/** 항상 보이는 결론 바 — "결국 몇 개를 발주하는가" */
export function PlanSummaryBar({ stats, actions, className }: PlanSummaryBarProps) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center gap-x-7 gap-y-3 border-t bg-card px-5 py-3 shadow-[0_-8px_24px_-20px_rgba(0,0,0,0.4)]',
        className
      )}
    >
      {stats.map((s, i) => (
        <div key={i} className="flex items-center gap-7">
          {i > 0 && <Separator orientation="vertical" className="h-8" />}
          <Kpi label={s.label} value={s.value} unit={s.unit} size="md" />
        </div>
      ))}
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
  )
}

type StepNavProps = {
  onPrev?: () => void
  onNext?: () => void
  prevLabel?: string
  nextLabel?: string
  nextDisabled?: boolean
}

/** 요약 바 우측에 붙는 이전/다음 버튼 쌍 */
export function StepNav({
  onPrev,
  onNext,
  prevLabel = '이전',
  nextLabel = '다음',
  nextDisabled,
}: StepNavProps) {
  return (
    <>
      {onPrev && (
        <Button type="button" variant="outline" size="sm" onClick={onPrev}>
          {prevLabel}
        </Button>
      )}
      {onNext && (
        <Button type="button" size="sm" onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
        </Button>
      )}
    </>
  )
}
