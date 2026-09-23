'use client'

import { cn } from '@/lib/utils'
import type { StockStatusSummary } from './stock-status-view-model'

type Props = {
  summary: StockStatusSummary
  loading: boolean
  /** 위치 탭 선택 중 — 위치별 출고 집계가 없어 등급을 계산하지 않는다 */
  locationScoped: boolean
  onlyLow: boolean
  onOnlyLowChange: (v: boolean) => void
}

const KRW = new Intl.NumberFormat('ko-KR')

/** 조치 중심 요약 한 줄 — 클릭하면 조치 필요 옵션만 필터. */
export function StockStatusSummaryBar({
  summary,
  loading,
  locationScoped,
  onlyLow,
  onOnlyLowChange,
}: Props) {
  if (loading) {
    return <div className="h-9 animate-pulse rounded-lg bg-muted" />
  }

  if (locationScoped) {
    return (
      <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        위치별 출고 집계가 없어 이 탭에서는 커버 일수·등급을 계산하지 않습니다. [전체 위치] 탭에서
        확인하세요.
      </p>
    )
  }

  const nothingToDo = summary.riskProductCount === 0 && summary.reorderProductCount === 0

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
      {nothingToDo ? (
        <span className="text-xs text-muted-foreground">지금 발주가 급한 상품이 없습니다</span>
      ) : (
        <>
          <button
            type="button"
            aria-pressed={onlyLow}
            onClick={() => onOnlyLowChange(!onlyLow)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              onlyLow
                ? 'border-red-300 bg-red-100 text-red-800'
                : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
            )}
          >
            <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
            위험 {KRW.format(summary.riskProductCount)}상품
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
            <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
            발주시기 {KRW.format(summary.reorderProductCount)}상품
          </span>
          {summary.noStockOptionCount > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              재고없음 {KRW.format(summary.noStockOptionCount)}옵션
            </span>
          )}
        </>
      )}
      {onlyLow && (
        <button
          type="button"
          onClick={() => onOnlyLowChange(false)}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          전체 보기
        </button>
      )}
    </div>
  )
}
