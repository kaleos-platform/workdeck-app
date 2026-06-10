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
  pctChange,
  seriesBucketValue,
  type OptionBucket,
  type OptionSeries,
} from '@/lib/sh/sales-analytics'

type Props = {
  buckets: OptionBucket[]
  /** 표 열 = 해석된 시리즈 (차트와 동일 단일 소스). */
  series: OptionSeries[]
  loading: boolean
}

/** 증감 % → 텍스트 컬러 + ▲▼. null 이면 "-". */
function DeltaText({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="inline-flex items-center text-xs text-muted-foreground">-</span>
  }
  const positive = pct >= 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium tabular-nums',
        positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
      )}
    >
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? '+' : ''}
      {pct.toFixed(1)}%
    </span>
  )
}

const qty = (n: number) => `${n.toLocaleString('ko-KR')}개`

export function OptionPivotTable({ buckets, series, loading }: Props) {
  // 버킷별 합계(표시 시리즈 합) — 차트 선들의 합과 일치
  const rowTotal = (b: OptionBucket) => series.reduce((s, ser) => s + seriesBucketValue(b, ser), 0)

  // 시리즈 열별 기간 합계 (하단 합계행)
  const seriesColumnTotals = useMemo(
    () => series.map((ser) => buckets.reduce((s, b) => s + seriesBucketValue(b, ser), 0)),
    [series, buckets]
  )

  const grandTotal = useMemo(
    () => seriesColumnTotals.reduce((s, v) => s + v, 0),
    [seriesColumnTotals]
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>기간별·상품(옵션)별 판매량</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : buckets.length === 0 || series.length === 0 ? (
          <p className="text-sm text-muted-foreground">해당 기간에 판매량 데이터가 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 bg-muted/40">기간</TableHead>
                  <TableHead className="bg-muted/40 text-right font-semibold">합계</TableHead>
                  <TableHead className="border-r bg-muted/40 text-right">증감</TableHead>
                  {series.map((ser) => (
                    <TableHead
                      key={ser.id}
                      className="w-[120px] text-right align-bottom break-keep whitespace-normal"
                    >
                      <span style={{ color: ser.color }}>{ser.name}</span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {buckets.map((bucket, idx) => {
                  const cur = rowTotal(bucket)
                  const prev = idx > 0 ? rowTotal(buckets[idx - 1]) : null
                  const delta = prev !== null ? pctChange(cur, prev) : null
                  return (
                    <TableRow key={bucket.key}>
                      <TableCell className="sticky left-0 z-10 bg-muted/40 font-medium">
                        {bucket.label}
                      </TableCell>
                      <TableCell className="bg-muted/40 text-right font-semibold tabular-nums">
                        {qty(cur)}
                      </TableCell>
                      <TableCell className="border-r bg-muted/40 text-right">
                        {idx === 0 ? (
                          <span className="text-xs text-muted-foreground">-</span>
                        ) : (
                          <DeltaText pct={delta} />
                        )}
                      </TableCell>
                      {series.map((ser) => (
                        <TableCell key={ser.id} className="w-[120px] text-right tabular-nums">
                          {qty(seriesBucketValue(bucket, ser))}
                        </TableCell>
                      ))}
                    </TableRow>
                  )
                })}
              </TableBody>
              {/* 합계 행 */}
              <TableBody>
                <TableRow className="border-t-2 font-semibold">
                  <TableCell className="sticky left-0 z-10 bg-muted/60">합계</TableCell>
                  <TableCell className="bg-muted/60 text-right tabular-nums">
                    {qty(grandTotal)}
                  </TableCell>
                  <TableCell className="border-r bg-muted/60 text-right">
                    <span className="text-xs text-muted-foreground">-</span>
                  </TableCell>
                  {series.map((ser, i) => (
                    <TableCell key={ser.id} className="w-[120px] text-right tabular-nums">
                      {qty(seriesColumnTotals[i])}
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
