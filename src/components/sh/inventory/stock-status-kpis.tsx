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
          label: '총 브랜드',
          value: KRW.format(kpis.totalBrands),
          unit: '개',
          meta: `${KRW.format(kpis.totalSkus)} SKU 등록`,
        },
        {
          label: '총 재고 수량',
          value: KRW.format(kpis.totalQty),
          unit: 'EA',
          meta: '전체 위치 합산',
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
          meta: '안전재고 기준',
        },
        {
          label: '평균 회전일',
          value: kpis.averageTurnoverDays === null ? '—' : KRW.format(kpis.averageTurnoverDays),
          unit: kpis.averageTurnoverDays === null ? undefined : '일',
          meta: '최근 30일 출고 기준',
        },
      ]
    : []

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-2 divide-x divide-y md:grid-cols-3 md:divide-y-0 lg:grid-cols-5">
        {items.length === 0
          ? Array.from({ length: 5 }).map((_, i) => <KpiCellSkeleton key={i} />)
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
