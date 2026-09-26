'use client'

import { useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  formatKRW,
  seriesBucketValue,
  type OptionBucket,
  type OptionSeries,
  type SalesMetric,
} from '@/lib/sh/sales-analytics'

type Props = {
  buckets: OptionBucket[]
  /** 누적 막대 층 = 해석된 시리즈 (미선택=상위 상품+기타, 선택 시 항목별). page 가 단일 소스. */
  series: OptionSeries[]
  /** 표시 지표 — 수량(개) / 매출(원). 아래 피벗과 공유한다. */
  metric: SalesMetric
  onMetricChange: (metric: SalesMetric) => void
  loading: boolean
}

type ChartRow = { label: string; [seriesId: string]: string | number }

const formatQty = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}개`
const formatMetric = (n: number, metric: SalesMetric) =>
  metric === 'revenue' ? formatKRW(n) : formatQty(n)

/**
 * 시리즈당 1행 툴팁.
 * - 값이 0인 시리즈는 숨긴다 (선택 옵션이 많으면 0개 행이 쌓여 차트 밖까지 넘침)
 * - 시리즈가 2개 이상일 때만 합계 행 (1선이면 값과 중복)
 */
function OptionTooltip({
  active,
  payload,
  label,
  series,
  metric,
}: {
  active?: boolean
  payload?: { payload: ChartRow }[]
  label?: string
  series: OptionSeries[]
  metric: SalesMetric
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const rows = series.map((s) => ({ s, qty: Number(row[s.id] ?? 0) }))
  const total = rows.reduce((acc, r) => acc + r.qty, 0)
  const visibleRows = rows.filter((r) => r.qty !== 0)

  return (
    <div className="min-w-[180px] space-y-1 rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-muted-foreground">{label}</p>
      {/* 시리즈 행만 스크롤 — 합계는 항상 보이도록 스크롤 영역 밖에 둔다 */}
      <div className="max-h-[168px] space-y-0.5 overflow-y-auto tabular-nums">
        {visibleRows.map((r) => (
          <p key={r.s.id} className="flex justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: r.s.color }}
              />
              <span className="text-muted-foreground">{r.s.name}</span>
            </span>
            <span>{formatMetric(r.qty, metric)}</span>
          </p>
        ))}
      </div>
      {series.length > 1 && (
        <p className="flex justify-between gap-3 border-t pt-1 tabular-nums">
          <span className="text-muted-foreground">합계</span>
          <span className="font-semibold">{formatMetric(total, metric)}</span>
        </p>
      )}
    </div>
  )
}

export function OptionStackedChart({ buckets, series, metric, onMetricChange, loading }: Props) {
  const chartData = useMemo<ChartRow[]>(() => {
    return buckets.map((b) => {
      const row: ChartRow = { label: b.label }
      for (const s of series) row[s.id] = seriesBucketValue(b, s, metric)
      return row
    })
  }, [buckets, series, metric])

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    series.forEach((s) => m.set(s.id, s.name))
    return m
  }, [series])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <CardTitle>
            {metric === 'revenue' ? '상품(옵션)별 매출 추이' : '상품(옵션)별 판매량 추이'}
          </CardTitle>
          {/* 지표 토글 — 차트·아래 피벗이 같은 축을 본다 */}
          <div className="flex gap-1">
            {(
              [
                ['revenue', '매출'],
                ['qty', '수량'],
              ] as const
            ).map(([m, label]) => (
              <Button
                key={m}
                variant={metric === m ? 'default' : 'outline'}
                size="sm"
                onClick={() => onMetricChange(m)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            불러오는 중...
          </div>
        ) : chartData.length === 0 || series.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            해당 기간에 표시할 데이터가 없습니다
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => Number(v).toLocaleString('ko-KR')}
              />
              <Tooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                allowEscapeViewBox={{ x: false, y: false }}
                wrapperStyle={{ zIndex: 50 }}
                content={(<OptionTooltip series={series} metric={metric} />) as never}
              />
              {/* 상품 탭은 Legend 가 유일한 색↔시리즈 단서라 유지한다.
                  단 시리즈가 많으면 줄바꿈이 무한정 늘어나 플롯을 침범하므로 높이를 묶는다. */}
              <Legend
                itemSorter={(item) => series.findIndex((s) => s.id === item.dataKey)}
                wrapperStyle={{ fontSize: 12, maxHeight: 56, overflowY: 'auto' }}
                formatter={(value) => nameById.get(String(value)) ?? String(value)}
              />
              {series.map((s, i) => (
                <Bar
                  key={s.id}
                  dataKey={s.id}
                  stackId="stack"
                  fill={s.color}
                  radius={i === series.length - 1 ? [3, 3, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
