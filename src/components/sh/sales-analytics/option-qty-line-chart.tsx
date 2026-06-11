'use client'

import { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { seriesBucketValue, type OptionBucket, type OptionSeries } from '@/lib/sh/sales-analytics'

type Props = {
  buckets: OptionBucket[]
  /** 차트 선 = 해석된 시리즈 (미선택=전체 1선, 선택 시 항목별 선). page 가 단일 소스. */
  series: OptionSeries[]
  loading: boolean
}

type ChartRow = { label: string; [seriesId: string]: string | number }

export function OptionQtyLineChart({ buckets, series, loading }: Props) {
  const chartData = useMemo<ChartRow[]>(() => {
    return buckets.map((b) => {
      const row: ChartRow = { label: b.label }
      for (const s of series) row[s.id] = seriesBucketValue(b, s)
      return row
    })
  }, [buckets, series])

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    series.forEach((s) => m.set(s.id, s.name))
    return m
  }, [series])

  return (
    <Card>
      <CardHeader>
        <CardTitle>상품(옵션)별 판매량 추이</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            불러오는 중...
          </div>
        ) : chartData.length === 0 || series.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            해당 기간에 판매량 데이터가 없습니다
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => Number(v).toLocaleString('ko-KR')}
              />
              <Tooltip
                formatter={
                  ((value: number | string | undefined, name: string | number | undefined) => {
                    const num = typeof value === 'number' ? value : Number(value ?? 0)
                    const key = String(name ?? '')
                    const display = nameById.get(key) ?? key
                    return [`${num.toLocaleString('ko-KR')}개`, display] as [string, string]
                  }) as never
                }
              />
              <Legend formatter={(value) => nameById.get(String(value)) ?? String(value)} />
              {series.map((s) => (
                <Line
                  key={s.id}
                  type="monotone"
                  dataKey={s.id}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
