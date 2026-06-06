'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, TrendingDown } from 'lucide-react'
import {
  bucketValueFor,
  deltaLabelForUnit,
  formatKRW,
  pctChange,
  resolveDisplayChannels,
  type RevenueBucket,
  type SalesUnit,
} from '@/lib/sh/sales-analytics'

type Channel = { id: string; name: string }
type ChannelTotal = {
  channelId: string
  totalRevenue: number
  orderCount: number
  isUnitCount: boolean
}

type Props = {
  unit: SalesUnit
  buckets: RevenueBucket[]
  channels: Channel[]
  channelTotals: ChannelTotal[]
  currentTotals: { totalRevenue: number; orderCount: number }
  prevTotals: { totalRevenue: number; orderCount: number }
  loading: boolean
}

/** 증감 % → ▲▼ Badge. null 이면 "-" */
function DeltaBadge({ pct, suffix }: { pct: number | null; suffix?: string }) {
  if (pct === null) {
    return <span className="text-xs text-muted-foreground">-</span>
  }
  const positive = pct >= 0
  return (
    <Badge variant={positive ? 'default' : 'destructive'} className="gap-0.5 text-xs">
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? '+' : ''}
      {pct.toFixed(1)}%{suffix ? ` ${suffix}` : ''}
    </Badge>
  )
}

export function SalesPivotTable({
  unit,
  buckets,
  channels,
  channelTotals,
  currentTotals,
  prevTotals,
  loading,
}: Props) {
  const displayChannels = useMemo(
    () => resolveDisplayChannels(channels, buckets),
    [channels, buckets]
  )

  // 로켓 등 isUnitCount 채널 id 집합 (주문수 "개" 표기용)
  const unitCountIds = useMemo(
    () => new Set(channelTotals.filter((c) => c.isUnitCount).map((c) => c.channelId)),
    [channelTotals]
  )
  // 표시 채널 중 하나라도 units 면 "개" 표기 (기타 묶음은 혼합 가능 → 표기 생략)
  const displayHasUnit = (chId: string) => unitCountIds.has(chId)

  // 합계 주문수는 "주문" 단위만 — 로켓(isUnitCount)의 수량은 제외 (서버 totals 규칙과 일치).
  // bucket.total.orderCount 는 로켓 qty 가 섞여 있어 직접 쓰면 오염되므로 채널별로 재집계.
  const bucketOrderTotal = (b: RevenueBucket): number => {
    let n = 0
    for (const [chId, agg] of Object.entries(b.byChannel)) {
      if (!unitCountIds.has(chId)) n += agg.orderCount
    }
    return n
  }

  const deltaLabel = deltaLabelForUnit(unit)

  // 채널 열별 합계 (매트릭스 하단 합계행)
  const channelColumnTotals = useMemo(() => {
    return displayChannels.map((dc) => {
      let revenue = 0
      let orderCount = 0
      for (const b of buckets) {
        const v = bucketValueFor(b, dc, displayChannels)
        revenue += v.revenue
        orderCount += v.orderCount
      }
      return { revenue, orderCount }
    })
  }, [displayChannels, buckets])

  return (
    <Card>
      <CardHeader>
        <CardTitle>기간별·채널별 현황</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : buckets.length === 0 ? (
          <p className="text-sm text-muted-foreground">해당 기간에 매출 데이터가 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 bg-background">기간</TableHead>
                  {displayChannels.map((dc) => (
                    <TableHead key={dc.id} className="text-right">
                      <span style={{ color: dc.color }}>{dc.name}</span>
                    </TableHead>
                  ))}
                  <TableHead className="text-right font-semibold">합계</TableHead>
                  <TableHead className="text-right">증감</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buckets.map((bucket, idx) => {
                  const prevBucket = idx > 0 ? buckets[idx - 1] : null
                  const rowPct = prevBucket
                    ? pctChange(bucket.total.revenue, prevBucket.total.revenue)
                    : null
                  return (
                    <TableRow key={bucket.key}>
                      <TableCell className="sticky left-0 z-10 bg-background font-medium">
                        {bucket.label}
                      </TableCell>
                      {displayChannels.map((dc) => {
                        const v = bucketValueFor(bucket, dc, displayChannels)
                        return (
                          <TableCell key={dc.id} className="text-right tabular-nums">
                            <div>{formatKRW(v.revenue)}</div>
                            <div className="text-xs text-muted-foreground">
                              {v.orderCount.toLocaleString('ko-KR')}
                              {displayHasUnit(dc.id) ? '개' : ''}
                            </div>
                          </TableCell>
                        )
                      })}
                      <TableCell className="text-right font-semibold tabular-nums">
                        <div>{formatKRW(bucket.total.revenue)}</div>
                        <div className="text-xs font-normal text-muted-foreground">
                          {bucketOrderTotal(bucket).toLocaleString('ko-KR')}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {idx === 0 ? (
                          <span className="text-xs text-muted-foreground">-</span>
                        ) : (
                          <DeltaBadge pct={rowPct} />
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
              {/* 합계 행 */}
              <TableBody>
                <TableRow className="border-t-2 font-semibold">
                  <TableCell className="sticky left-0 z-10 bg-background">합계</TableCell>
                  {displayChannels.map((dc, i) => (
                    <TableCell key={dc.id} className="text-right tabular-nums">
                      <div>{formatKRW(channelColumnTotals[i].revenue)}</div>
                      <div className="text-xs font-normal text-muted-foreground">
                        {channelColumnTotals[i].orderCount.toLocaleString('ko-KR')}
                        {displayHasUnit(dc.id) ? '개' : ''}
                      </div>
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">
                    <div>{formatKRW(currentTotals.totalRevenue)}</div>
                    <div className="text-xs font-normal text-muted-foreground">
                      {currentTotals.orderCount.toLocaleString('ko-KR')}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <DeltaBadge
                      pct={pctChange(currentTotals.totalRevenue, prevTotals.totalRevenue)}
                      suffix={deltaLabel}
                    />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
