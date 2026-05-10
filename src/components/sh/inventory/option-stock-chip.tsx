'use client'

import { TrendingDown } from 'lucide-react'

type Props = {
  optionName: string
  quantity: number
  outbound7d: number
}

function getWarningClass(quantity: number, outbound7d: number) {
  if (outbound7d > 0 && quantity < outbound7d) {
    return {
      border: 'border-l-red-500',
      bg: 'bg-red-50 dark:bg-red-950/30',
      bar: 'bg-red-400',
    }
  }
  if (outbound7d > 0 && quantity < outbound7d * 2) {
    return {
      border: 'border-l-amber-500',
      bg: 'bg-amber-50 dark:bg-amber-950/30',
      bar: 'bg-amber-400',
    }
  }
  return {
    border: 'border-l-border',
    bg: 'bg-card',
    bar: 'bg-emerald-400',
  }
}

export function OptionStockChip({ optionName, quantity, outbound7d }: Props) {
  const warn = getWarningClass(quantity, outbound7d)
  const barPercent =
    outbound7d === 0 ? 100 : Math.min(100, Math.max(0, (quantity / (outbound7d * 2)) * 100))

  return (
    <div
      className={`rounded-lg border border-l-4 px-3 py-2 transition-colors duration-150 ${warn.border} ${warn.bg}`}
      aria-label={`${optionName} — 재고 ${quantity}개, 7일 출고 ${outbound7d}개`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{optionName}</span>
        <span
          className={`text-2xl leading-none font-semibold tabular-nums ${quantity === 0 ? 'text-muted-foreground' : ''}`}
        >
          {quantity.toLocaleString()}
        </span>
      </div>

      {/* 비율 인디케이터 */}
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-150 ${warn.bar}`}
          style={{ width: `${barPercent}%` }}
        />
      </div>

      {/* 7일 출고 */}
      <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
        <TrendingDown className="h-3 w-3 shrink-0" />
        <span>{outbound7d.toLocaleString()} · 7일</span>
      </div>
    </div>
  )
}
