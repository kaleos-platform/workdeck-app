'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LOCATION_TYPE_LABEL, type StockLocation } from './stock-status.types'

type Props = {
  locations: StockLocation[]
  loading: boolean
}

const KRW = new Intl.NumberFormat('ko-KR')

function formatValue(n: number): string {
  if (n >= 100_000_000) return `₩${(n / 100_000_000).toFixed(1)}억`
  if (n >= 10_000) return `₩${(n / 10_000).toFixed(0)}만`
  return `₩${KRW.format(n)}`
}

export function StockStatusLocations({ locations, loading }: Props) {
  const totalQty = locations.reduce((s, l) => s + l.totalQty, 0)

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-sm">위치별 재고 분포</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : locations.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">등록된 위치가 없습니다</p>
        ) : (
          <div className="divide-y">
            {locations.map((loc) => {
              const share = totalQty > 0 ? (loc.totalQty / totalQty) * 100 : 0
              const dist = loc.healthDistribution
              const okPct = dist.total > 0 ? (dist.ok / dist.total) * 100 : 0
              const lowPct = dist.total > 0 ? (dist.low / dist.total) * 100 : 0
              const outPct = dist.total > 0 ? (dist.out / dist.total) * 100 : 0
              return (
                <div key={loc.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{loc.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {LOCATION_TYPE_LABEL[loc.type]}
                        </Badge>
                      </div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">
                        SKU {KRW.format(loc.skuCount)} · {formatValue(loc.totalValue)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-semibold tabular-nums">
                        {KRW.format(loc.totalQty)}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground tabular-nums">
                        {share.toFixed(1)}% 비중
                      </div>
                    </div>
                  </div>
                  <div
                    className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted"
                    title={`정상 ${dist.ok} · 부족 ${dist.low} · 결품 ${dist.out}`}
                  >
                    <div className="h-full bg-emerald-500" style={{ width: `${okPct}%` }} />
                    <div className="h-full bg-amber-500" style={{ width: `${lowPct}%` }} />
                    <div className="h-full bg-red-500" style={{ width: `${outPct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
