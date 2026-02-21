'use client'

import { useState } from 'react'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { BarChart3 } from 'lucide-react'
import type { MetricSeries, DailyMemo } from '@/types'

type Metric = 'adCost' | 'roas' | 'ctr' | 'cvr'

interface MetricConfig {
  key: Metric
  label: string
  color: string
  unit: string
  yAxisId: 'left' | 'right'
}

const METRIC_CONFIGS: MetricConfig[] = [
  { key: 'adCost', label: '총광고비', color: '#3b82f6', unit: '원', yAxisId: 'left' },
  { key: 'roas', label: '평균ROAS', color: '#f97316', unit: '%', yAxisId: 'right' },
  { key: 'ctr', label: 'CTR', color: '#22c55e', unit: '%', yAxisId: 'right' },
  { key: 'cvr', label: 'CVR', color: '#a855f7', unit: '%', yAxisId: 'right' },
]

interface CampaignChartProps {
  data: MetricSeries[]
  memos?: DailyMemo[]
  onChartClick?: (date: string) => void
}

function formatValue(value: number, unit: string): string {
  if (unit === '원') return `${value.toLocaleString()}원`
  if (unit === '%') return `${value}%`
  return `${value.toLocaleString()}${unit}`
}

function formatDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-')
  return `${month}/${day}`
}

export function CampaignChart({ data, memos = [], onChartClick }: CampaignChartProps) {
  const [activeMetrics, setActiveMetrics] = useState<Metric[]>(['adCost', 'roas'])

  function toggleMetric(metric: Metric) {
    setActiveMetrics((prev) =>
      prev.includes(metric)
        ? prev.length > 1
          ? prev.filter((m) => m !== metric)
          : prev // 최소 1개 유지
        : [...prev, metric]
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-3 text-muted-foreground">
        <BarChart3 className="h-12 w-12 opacity-30" />
        <p className="text-sm">데이터를 업로드하면 차트가 표시됩니다</p>
      </div>
    )
  }

  // 메모가 있는 날짜 set (원본 날짜 형식)
  const memoDateSet = new Set(memos.map((m) => m.date))

  // 차트용 데이터 (날짜 포맷 + 원본 날짜 유지)
  const chartData = data.map((d) => ({
    ...d,
    originalDate: d.date,
    date: formatDate(d.date),
  }))

  // 메모 있는 날짜의 포맷된 날짜 목록 (ReferenceLine용)
  const memoDates = data.filter((d) => memoDateSet.has(d.date)).map((d) => formatDate(d.date))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleChartClick(chartEvent: any) {
    if (!onChartClick) return
    const originalDate = chartEvent?.activePayload?.[0]?.payload?.originalDate
    if (originalDate) onChartClick(originalDate as string)
  }

  return (
    <div className="space-y-4">
      {/* 지표 토글 버튼 */}
      <div className="flex flex-wrap gap-2">
        {METRIC_CONFIGS.map((config) => {
          const isActive = activeMetrics.includes(config.key)
          return (
            <Button
              key={config.key}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => toggleMetric(config.key)}
              className="h-7 gap-1.5 text-xs"
              style={isActive ? { backgroundColor: config.color, borderColor: config.color } : {}}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: isActive ? 'white' : config.color }}
              />
              {config.label}
            </Button>
          )
        })}
      </div>

      {/* 차트 */}
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart
          data={chartData}
          margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
          onClick={handleChartClick}
          style={onChartClick ? { cursor: 'pointer' } : undefined}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            formatter={(value: number | undefined, name: string | undefined) => {
              const config = METRIC_CONFIGS.find((c) => c.label === name)
              return [formatValue(value ?? 0, config?.unit ?? ''), name ?? '']
            }}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid hsl(var(--border))',
              backgroundColor: 'hsl(var(--background))',
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />

          {/* 메모 있는 날짜 표시 (노란 점선) */}
          {memoDates.map((d) => (
            <ReferenceLine
              key={`memo-${d}`}
              x={d}
              yAxisId="left"
              stroke="#f59e0b"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={{ value: '📌', position: 'top', fontSize: 10 }}
            />
          ))}

          {METRIC_CONFIGS.map((config) => {
            if (!activeMetrics.includes(config.key)) return null
            return (
              <Line
                key={config.key}
                dataKey={config.key}
                name={config.label}
                stroke={config.color}
                yAxisId={config.yAxisId}
                type="monotone"
                dot={false}
                strokeWidth={2}
                connectNulls={false}
              />
            )
          })}
        </ComposedChart>
      </ResponsiveContainer>

      {memos.length > 0 && (
        <p className="text-xs text-muted-foreground">
          📌 표시된 날짜에 메모가 있습니다. 클릭하면 메모를 확인할 수 있습니다.
        </p>
      )}
    </div>
  )
}
