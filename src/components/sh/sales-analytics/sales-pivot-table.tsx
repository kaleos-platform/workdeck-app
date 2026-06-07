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
import { TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  bucketOrderTotal,
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

/** 증감 % → 텍스트 컬러 + ▲▼ + 부호. 배경 없음. null 이면 "-". prefix=라벨(매출/주문) */
function DeltaText({
  pct,
  prefix,
  suffix,
}: {
  pct: number | null
  prefix?: string
  suffix?: string
}) {
  const label = prefix ? <span className="mr-1 text-muted-foreground">{prefix}</span> : null
  if (pct === null) {
    return <span className="inline-flex items-center text-xs text-muted-foreground">{label}-</span>
  }
  const positive = pct >= 0
  return (
    <span className="inline-flex items-center text-xs tabular-nums">
      {label}
      <span
        className={cn(
          'inline-flex items-center gap-0.5 font-medium',
          positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
        )}
      >
        {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {positive ? '+' : ''}
        {pct.toFixed(1)}%{suffix ? ` ${suffix}` : ''}
      </span>
    </span>
  )
}

/** 매출·주문 증감 2줄 묶음 */
function DeltaPair({
  revPct,
  ordPct,
  suffix,
}: {
  revPct: number | null
  ordPct: number | null
  suffix?: string
}) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <DeltaText pct={revPct} prefix="매출" suffix={suffix} />
      <DeltaText pct={ordPct} prefix="주문" suffix={suffix} />
    </div>
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

  // 합계 주문수("주문" 단위, 로켓 units 제외) — 공유 헬퍼 (차트와 동일 값)
  const orderTotal = (b: RevenueBucket): number => bucketOrderTotal(b, unitCountIds)

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
                  <TableHead className="sticky left-0 z-10 bg-muted/40">기간</TableHead>
                  <TableHead className="bg-muted/40 text-right font-semibold">합계</TableHead>
                  <TableHead className="border-r bg-muted/40 text-right">증감</TableHead>
                  {displayChannels.map((dc) => (
                    <TableHead key={dc.id} className="text-right">
                      <span style={{ color: dc.color }}>{dc.name}</span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {buckets.map((bucket, idx) => {
                  const prevBucket = idx > 0 ? buckets[idx - 1] : null
                  const revPct = prevBucket
                    ? pctChange(bucket.total.revenue, prevBucket.total.revenue)
                    : null
                  const ordPct = prevBucket
                    ? pctChange(orderTotal(bucket), orderTotal(prevBucket))
                    : null
                  return (
                    <TableRow key={bucket.key}>
                      <TableCell className="sticky left-0 z-10 bg-muted/40 font-medium">
                        {bucket.label}
                      </TableCell>
                      <TableCell className="bg-muted/40 text-right font-semibold tabular-nums">
                        <div>{formatKRW(bucket.total.revenue)}</div>
                        <div className="font-normal">
                          {orderTotal(bucket).toLocaleString('ko-KR')}건
                        </div>
                      </TableCell>
                      <TableCell className="border-r bg-muted/40 text-right">
                        {idx === 0 ? (
                          <span className="text-xs text-muted-foreground">-</span>
                        ) : (
                          <DeltaPair revPct={revPct} ordPct={ordPct} />
                        )}
                      </TableCell>
                      {displayChannels.map((dc) => {
                        const v = bucketValueFor(bucket, dc, displayChannels)
                        const unitLabel = displayHasUnit(dc.id) ? '개' : '건'
                        return (
                          <TableCell key={dc.id} className="text-right tabular-nums">
                            <div>{formatKRW(v.revenue)}</div>
                            <div>
                              {v.orderCount.toLocaleString('ko-KR')}
                              {unitLabel}
                            </div>
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  )
                })}
              </TableBody>
              {/* 합계 행 */}
              <TableBody>
                <TableRow className="border-t-2 font-semibold">
                  <TableCell className="sticky left-0 z-10 bg-muted/60">합계</TableCell>
                  <TableCell className="bg-muted/60 text-right tabular-nums">
                    <div>{formatKRW(currentTotals.totalRevenue)}</div>
                    <div className="font-normal">
                      {currentTotals.orderCount.toLocaleString('ko-KR')}건
                    </div>
                  </TableCell>
                  <TableCell className="border-r bg-muted/60 text-right">
                    <DeltaPair
                      revPct={pctChange(currentTotals.totalRevenue, prevTotals.totalRevenue)}
                      ordPct={pctChange(currentTotals.orderCount, prevTotals.orderCount)}
                      suffix={deltaLabel}
                    />
                  </TableCell>
                  {displayChannels.map((dc, i) => (
                    <TableCell key={dc.id} className="text-right tabular-nums">
                      <div>{formatKRW(channelColumnTotals[i].revenue)}</div>
                      <div className="font-normal">
                        {channelColumnTotals[i].orderCount.toLocaleString('ko-KR')}
                        {displayHasUnit(dc.id) ? '개' : '건'}
                      </div>
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
