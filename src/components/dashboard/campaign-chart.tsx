'use client'

import { useState } from 'react'
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { BarChart3 } from 'lucide-react'
import type { MetricSeries } from '@/types'

type Metric = 'roas14d' | 'adCost' | 'clicks' | 'impressions'

interface MetricConfig {
  key: Metric
  label: string
  color: string
  type: 'line' | 'bar'
  unit: string
  yAxisId: 'left' | 'right'
}

const METRIC_CONFIGS: MetricConfig[] = [
  { key: 'roas14d', label: 'ROAS(14일)', color: '#f97316', type: 'line', unit: '%', yAxisId: 'right' },
  { key: 'adCost', label: '광고비', color: '#3b82f6', type: 'bar', unit: '원', yAxisId: 'left' },
  { key: 'clicks', label: '클릭수', color: '#22c55e', type: 'line', unit: '회', yAxisId: 'left' },
  { key: 'impressions', label: '노출수', color: '#a855f7', type: 'bar', unit: '회', yAxisId: 'left' },
]

interface CampaignChartProps {
  data: MetricSeries[]
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

export function CampaignChart({ data }: CampaignChartProps) {
  const [activeMetrics, setActiveMetrics] = useState<Metric[]>(['roas14d', 'adCost'])

  function toggleMetric(metric: Metric) {
    setActiveMetrics((prev) =>
      prev.includes(metric)
        ? prev.length > 1 ? prev.filter((m) => m !== metric) : prev // 최소 1개 유지
        : [...prev, metric]
    )
  }

  if (data.length === 0) {
    return (
      <div className="h-72 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <BarChart3 className="h-12 w-12 opacity-30" />
        <p className="text-sm">데이터를 업로드하면 차트가 표시됩니다</p>
      </div>
    )
  }

  const chartData = data.map((d) => ({ ...d, date: formatDate(d.date) }))

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
              className="gap-1.5 text-xs h-7"
              style={isActive ? { backgroundColor: config.color, borderColor: config.color } : {}}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: isActive ? 'white' : config.color }}
              />
              {config.label}
            </Button>
          )
        })}
      </div>

      {/* 차트 */}
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
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

          {METRIC_CONFIGS.map((config) => {
            if (!activeMetrics.includes(config.key)) return null
            if (config.type === 'bar') {
              return (
                <Bar
                  key={config.key}
                  dataKey={config.key}
                  name={config.label}
                  fill={config.color}
                  yAxisId={config.yAxisId}
                  radius={[2, 2, 0, 0]}
                  opacity={0.8}
                />
              )
            }
            return (
              <Line
                key={config.key}
                dataKey={config.key}
                name={config.label}
                stroke={config.color}
                yAxisId={config.yAxisId}
                type="monotone"
                dot={{ r: 3 }}
                strokeWidth={2}
              />
            )
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
