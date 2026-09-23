'use client'

import { cn } from '@/lib/utils'
import { STOCK_GRADE_LABEL, type StockGrade } from './stock-status-view-model'

/** 등급 색 — 카드(좌측 목록)와 매트릭스(우측 표)가 같은 색을 쓴다. */
const GRADE_DOT: Record<StockGrade, string> = {
  NO_STOCK: 'bg-red-500',
  RISK: 'bg-red-500',
  REORDER: 'bg-amber-500',
  HEALTHY: 'bg-emerald-500',
  NO_OUTBOUND: 'bg-muted-foreground/40',
}

const GRADE_TEXT: Record<StockGrade, string> = {
  NO_STOCK: 'text-red-700',
  RISK: 'text-red-700',
  REORDER: 'text-amber-700',
  HEALTHY: 'text-emerald-700',
  NO_OUTBOUND: 'text-muted-foreground',
}

/** 커버 일수 표기 — 소수는 버림 없이 반올림하되 1일 미만은 따로 구분한다. */
export function formatDaysOfCover(days: number | null): string | null {
  if (days === null) return null
  if (days <= 0) return '0일치'
  if (days < 1) return '1일 미만'
  if (days >= 999) return '999일+'
  return `${Math.round(days)}일치`
}

type Props = {
  grade: StockGrade | null
  daysOfCover: number | null
  /** 라벨 생략 — 표에서는 숫자 옆 점만 쓴다 */
  hideLabel?: boolean
  className?: string
}

export function StockGradeMark({ grade, daysOfCover, hideLabel, className }: Props) {
  if (grade === null) return <span className="text-muted-foreground/50">—</span>

  const days = formatDaysOfCover(daysOfCover)
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-[11px]', GRADE_TEXT[grade], className)}
    >
      <span className={cn('h-2 w-2 shrink-0 rounded-full', GRADE_DOT[grade])} aria-hidden="true" />
      {!hideLabel && <span className="font-medium">{STOCK_GRADE_LABEL[grade]}</span>}
      {days && grade !== 'NO_STOCK' && grade !== 'NO_OUTBOUND' && (
        <span className="font-mono tabular-nums">{days}</span>
      )}
    </span>
  )
}
