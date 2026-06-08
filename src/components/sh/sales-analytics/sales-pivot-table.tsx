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
  bucketTotalsFor,
  bucketValueFor,
  formatKRW,
  pctChange,
  resolveDisplayChannels,
  type RevenueBucket,
} from '@/lib/sh/sales-analytics'

type VisibleChannel = { id: string; name: string }

type Props = {
  buckets: RevenueBucket[]
  visibleChannels: VisibleChannel[]
  loading: boolean
}

/** 증감 % → 텍스트 컬러 + ▲▼ + 부호. 배경 없음. null 이면 "-". prefix=라벨(매출/주문) */
function DeltaText({ pct, prefix }: { pct: number | null; prefix?: string }) {
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
        {pct.toFixed(1)}%
      </span>
    </span>
  )
}

/** 매출·주문 증감 2줄 묶음 */
function DeltaPair({ revPct, ordPct }: { revPct: number | null; ordPct: number | null }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <DeltaText pct={revPct} prefix="매출" />
      <DeltaText pct={ordPct} prefix="주문" />
    </div>
  )
}

export function SalesPivotTable({ buckets, visibleChannels, loading }: Props) {
  // 표시 채널을 매출 desc 정렬 + 색상 부여 (차트와 동일 소스)
  const displayChannels = useMemo(
    () => resolveDisplayChannels(visibleChannels, buckets),
    [visibleChannels, buckets]
  )
  const displayIds = useMemo(() => displayChannels.map((dc) => dc.id), [displayChannels])

  // 합계 = 표시(선택) 채널 합 — 보이는 채널 열 합과 일치 (전 채널 주문 기준)
  const totalsFor = (b: RevenueBucket) => bucketTotalsFor(b, displayIds)

  // 채널 열별 합계 (매트릭스 하단 합계행)
  const channelColumnTotals = useMemo(() => {
    return displayChannels.map((dc) => {
      let revenue = 0
      let orderCount = 0
      for (const b of buckets) {
        const v = bucketValueFor(b, dc.id)
        revenue += v.revenue
        orderCount += v.orderCount
      }
      return { revenue, orderCount }
    })
  }, [displayChannels, buckets])

  // 전체 합계행 수치 (선택 채널 열 합)
  const grandTotal = useMemo(() => {
    let revenue = 0
    let orderCount = 0
    for (let i = 0; i < displayChannels.length; i++) {
      revenue += channelColumnTotals[i].revenue
      orderCount += channelColumnTotals[i].orderCount
    }
    return { revenue, orderCount }
  }, [displayChannels, channelColumnTotals])

  const noChannels = displayChannels.length === 0

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
        ) : noChannels ? (
          <p className="text-sm text-muted-foreground">표시할 채널을 선택하세요</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 bg-muted/40">기간</TableHead>
                  <TableHead className="bg-muted/40 text-right font-semibold">합계</TableHead>
                  <TableHead className="border-r bg-muted/40 text-right">증감</TableHead>
                  {displayChannels.map((dc) => (
                    <TableHead
                      key={dc.id}
                      className="w-[110px] text-right align-bottom break-keep whitespace-normal"
                    >
                      <span style={{ color: dc.color }}>{dc.name}</span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {buckets.map((bucket, idx) => {
                  const cur = totalsFor(bucket)
                  const prevBucket = idx > 0 ? buckets[idx - 1] : null
                  const prev = prevBucket ? totalsFor(prevBucket) : null
                  const revPct = prev ? pctChange(cur.revenue, prev.revenue) : null
                  const ordPct = prev ? pctChange(cur.orderCount, prev.orderCount) : null
                  return (
                    <TableRow key={bucket.key}>
                      <TableCell className="sticky left-0 z-10 bg-muted/40 font-medium">
                        {bucket.label}
                      </TableCell>
                      <TableCell className="bg-muted/40 text-right font-semibold tabular-nums">
                        <div>{formatKRW(cur.revenue)}</div>
                        <div className="font-normal">
                          {cur.orderCount.toLocaleString('ko-KR')}건
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
                        const v = bucketValueFor(bucket, dc.id)
                        return (
                          <TableCell key={dc.id} className="w-[110px] text-right tabular-nums">
                            <div className="break-all">{formatKRW(v.revenue)}</div>
                            <div>{v.orderCount.toLocaleString('ko-KR')}건</div>
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  )
                })}
              </TableBody>
              {/* 합계 행 (증감 없음) */}
              <TableBody>
                <TableRow className="border-t-2 font-semibold">
                  <TableCell className="sticky left-0 z-10 bg-muted/60">합계</TableCell>
                  <TableCell className="bg-muted/60 text-right tabular-nums">
                    <div>{formatKRW(grandTotal.revenue)}</div>
                    <div className="font-normal">
                      {grandTotal.orderCount.toLocaleString('ko-KR')}건
                    </div>
                  </TableCell>
                  <TableCell className="border-r bg-muted/60 text-right">
                    <span className="text-xs text-muted-foreground">-</span>
                  </TableCell>
                  {displayChannels.map((dc, i) => (
                    <TableCell key={dc.id} className="w-[110px] text-right tabular-nums">
                      <div className="break-all">{formatKRW(channelColumnTotals[i].revenue)}</div>
                      <div className="font-normal">
                        {channelColumnTotals[i].orderCount.toLocaleString('ko-KR')}건
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
