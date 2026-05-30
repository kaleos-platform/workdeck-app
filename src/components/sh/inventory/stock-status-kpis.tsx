'use client'

import { Card } from '@/components/ui/card'
import type { StockKpis } from './stock-status.types'

type Props = {
  kpis: StockKpis | null
}

const KRW = new Intl.NumberFormat('ko-KR')

function formatValue(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}억`
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만`
  return KRW.format(n)
}

export function StockStatusKpis({ kpis }: Props) {
  const items: Array<{
    label: string
    value: string
    unit?: string
    meta: string
  }> = kpis
    ? [
        {
          label: '총 재고 수량',
          value: KRW.format(kpis.totalQty),
          unit: 'EA',
          meta: `${KRW.format(kpis.totalSkus)} SKU 전체 위치 합산`,
        },
        {
          label: '총 재고 가치',
          value: `₩${formatValue(kpis.totalValue)}`,
          meta: '원가 × 수량 기준',
        },
        {
          label: '재고 부족 SKU',
          value: KRW.format(kpis.lowStockCount),
          unit: `/ ${KRW.format(kpis.totalSkus)}`,
          meta: '최근 30일 출고량 기준 (부족·결품)',
        },
      ]
    : []

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {items.length === 0
          ? Array.from({ length: 3 }).map((_, i) => <KpiCellSkeleton key={i} />)
          : items.map((item) => (
              <KpiCell
                key={item.label}
                label={item.label}
                value={item.value}
                unit={item.unit}
                meta={item.meta}
              />
            ))}
      </div>
    </Card>
  )
}

function KpiCell({
  label,
  value,
  unit,
  meta,
}: {
  label: string
  value: string
  unit?: string
  meta: string
}) {
  return (
    <div className="p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{meta}</div>
    </div>
  )
}

function KpiCellSkeleton() {
  return (
    <div className="p-4">
      <div className="h-3 w-16 animate-pulse rounded bg-muted" />
      <div className="mt-3 h-7 w-24 animate-pulse rounded bg-muted" />
      <div className="mt-3 h-3 w-20 animate-pulse rounded bg-muted" />
    </div>
  )
}
