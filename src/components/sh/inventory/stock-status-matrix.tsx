'use client'

import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  LOCATION_TYPE_LABEL,
  STATUS_LABEL,
  type StockLocation,
  type SkuStatus,
} from './stock-status.types'
import { StockStatusExportButton } from './stock-status-export'
import type { StockStatusRowView } from './stock-status-view-model'

type Props = {
  rows: StockStatusRowView[]
  locations: StockLocation[]
  loading: boolean
  selectedLocationId?: string | null
  selectedProductName?: string | null
  toolbar?: ReactNode
}

const KRW = new Intl.NumberFormat('ko-KR')
const ROW_CAP = 500

const STATUS_BADGE: Record<SkuStatus, string> = {
  OK: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  LOW: 'border-amber-300 bg-amber-50 text-amber-700',
  OUT: 'border-red-300 bg-red-50 text-red-700',
  OVER: 'border-indigo-300 bg-indigo-50 text-indigo-700',
}

export function StockStatusMatrix({
  rows,
  locations,
  loading,
  selectedLocationId,
  selectedProductName,
  toolbar,
}: Props) {
  const capped = rows.length > ROW_CAP
  const displayRows = capped ? rows.slice(0, ROW_CAP) : rows
  const visibleLocations = selectedLocationId
    ? locations.filter((l) => l.id === selectedLocationId)
    : locations

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-3">
        <CardTitle className="text-sm">{selectedProductName ?? '전체 상품'}</CardTitle>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {toolbar}
          <div className="flex items-center gap-3">
            <div className="text-xs text-muted-foreground">
              {KRW.format(rows.length)}건{capped && ` · 상위 ${ROW_CAP}건만 표시`}
            </div>
            <StockStatusExportButton
              rows={rows}
              locations={locations}
              selectedLocationId={selectedLocationId ?? null}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">표시할 SKU가 없습니다</p>
        ) : (
          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead className="sticky top-0 z-20 bg-muted">
                <tr className="border-b">
                  <th className="sticky left-0 z-30 min-w-[240px] border-r bg-muted px-3 py-2 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    옵션
                  </th>
                  <th className="min-w-[96px] border-l bg-muted px-2 py-2 text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    30일 출고량
                  </th>
                  <th className="min-w-[96px] border-l bg-muted px-2 py-2 text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    90일 출고량
                  </th>
                  {visibleLocations.map((l) => (
                    <th
                      key={l.id}
                      className="min-w-[100px] border-l bg-muted px-2 py-2 text-center text-[11px] font-medium text-muted-foreground"
                    >
                      <div className="truncate font-semibold text-foreground" title={l.name}>
                        {l.name}
                      </div>
                      <div className="text-[10px] font-normal text-muted-foreground">
                        {LOCATION_TYPE_LABEL[l.type]}
                      </div>
                    </th>
                  ))}
                  <th className="min-w-[90px] border-l bg-muted px-2 py-2 text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    입고예정
                  </th>
                  <th className="sticky right-0 z-30 min-w-[140px] border-l bg-muted px-3 py-2 text-right text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    합계
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => {
                  return (
                    <tr key={row.optionId} className="border-b hover:bg-muted/30">
                      <td className="sticky left-0 z-10 border-r bg-card px-3 py-2">
                        <div className="text-sm font-medium">{row.optionName}</div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {row.productInternalName && row.productInternalName !== row.productName
                            ? `${row.productName} · ${row.productInternalName}`
                            : row.productName}
                        </div>
                      </td>
                      <td className="border-l px-2 py-2 text-center font-mono text-sm tabular-nums">
                        {row.out30d > 0 ? (
                          KRW.format(row.out30d)
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="border-l px-2 py-2 text-center font-mono text-sm tabular-nums">
                        {row.out90d > 0 ? (
                          KRW.format(row.out90d)
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      {visibleLocations.map((l) => {
                        const qty = row.byLocation[l.id]
                        // 셀 단위 출고량 데이터가 없어 위치별 부족 판정 불가.
                        // 상태(부족/과잉)는 합계 컬럼의 배지로만 표시하고, 셀은 결품(0)만 강조.
                        return (
                          <td
                            key={l.id}
                            className={cn(
                              'border-l px-2 py-2 text-center font-mono text-sm tabular-nums',
                              qty === undefined
                                ? 'text-muted-foreground/50'
                                : qty === 0
                                  ? 'bg-red-50 text-red-700'
                                  : ''
                            )}
                          >
                            {qty === undefined ? '—' : KRW.format(qty)}
                          </td>
                        )
                      })}
                      {/* 입고예정 컬럼 */}
                      <td className="border-l px-2 py-2 text-center font-mono text-sm tabular-nums">
                        {row.incomingQty > 0 ? (
                          <span className="text-blue-600">{KRW.format(row.incomingQty)}</span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      {/* 합계 + 상태 */}
                      <td className="sticky right-0 z-10 border-l bg-card px-3 py-2 text-right">
                        <div className="font-mono text-sm font-semibold tabular-nums">
                          {KRW.format(row.displayQty)}
                        </div>
                        <div className="mt-0.5 flex items-center justify-end gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn('text-[10px]', STATUS_BADGE[row.displayStatus])}
                          >
                            {STATUS_LABEL[row.displayStatus]}
                          </Badge>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {capped && (
          <div className="border-t bg-muted/20 px-4 py-2 text-center text-xs text-muted-foreground">
            결과가 많습니다. 검색이나 필터로 좁혀주세요.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
