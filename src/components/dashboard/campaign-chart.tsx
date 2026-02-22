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
  ReferenceDot,
  ResponsiveContainer,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { BarChart3 } from 'lucide-react'
import type { MetricSeries, DailyMemo } from '@/types'
import type { MouseHandlerDataParam } from 'recharts/types/synchronisation/types'

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

type ChartDatum = MetricSeries & {
  originalDate: string
  date: string
  memoContent: string | null
}

type TooltipEntry = {
  name?: string
  value?: number | string | null
  payload?: ChartDatum
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

  // 메모 날짜별 내용 매핑
  const memoMap = new Map(memos.map((m) => [m.date, m.content]))

  // 차트용 데이터 (날짜 포맷 + 원본 날짜 유지)
  const chartData: ChartDatum[] = data.map((d) => ({
    ...d,
    originalDate: d.date,
    date: formatDate(d.date),
    memoContent: memoMap.get(d.date) ?? null,
  }))

  // 메모가 있는 날짜 포인트
  const memoPoints = chartData.filter((d) => d.memoContent)

  // 차트 클릭 시 활성화된 tooltip index를 기준으로 원본 날짜를 계산
  function handleChartClick(nextState: MouseHandlerDataParam) {
    if (!onChartClick) return
    const rawIndex = nextState.activeTooltipIndex
    const pointIndex = typeof rawIndex === 'number' ? rawIndex : Number(rawIndex)
    if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= chartData.length) return

    const clickedDate = chartData[pointIndex]?.originalDate
    if (clickedDate) onChartClick(clickedDate)
  }

  function renderTooltipContent({
    active,
    payload,
  }: {
    active?: boolean
    payload?: readonly TooltipEntry[]
  }) {
    if (!active || !payload || payload.length === 0) return null

    const point = payload[0]?.payload
    if (!point) return null

    return (
      <div className="min-w-44 rounded-md border bg-background p-2 text-xs shadow-sm">
        <p className="mb-1 font-semibold text-foreground">{point.originalDate}</p>
        <div className="space-y-0.5">
          {payload
            .filter((entry) => typeof entry.value === 'number')
            .map((entry) => {
              const config = METRIC_CONFIGS.find((c) => c.label === entry.name)
              const value = Number(entry.value)
              return (
                <p key={`${point.originalDate}-${entry.name}`} className="text-muted-foreground">
                  {entry.name}: {formatValue(value, config?.unit ?? '')}
                </p>
              )
            })}
        </div>
        {point.memoContent ? (
          <div className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            📌 {point.memoContent}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">
            클릭하면 이 날짜의 메모를 작성할 수 있습니다.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border border-dashed px-3 py-2">
        <p className="text-xs text-muted-foreground">
          차트의 날짜 지점을 클릭하면 해당 일자의 메모를 추가/수정할 수 있습니다.
        </p>
        <span className="text-[11px] text-amber-700">📌 메모 {memos.length}건</span>
      </div>

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
            content={renderTooltipContent}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid hsl(var(--border))',
              backgroundColor: 'hsl(var(--background))',
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />

          {/* 메모가 있는 날짜는 차트 내 핀 아이콘으로 표시 */}
          {memoPoints.map((point) => (
            <ReferenceDot
              key={`memo-${point.originalDate}`}
              x={point.date}
              y={point.adCost}
              yAxisId="left"
              ifOverflow="extendDomain"
              r={4}
              fill="#f59e0b"
              stroke="#fff"
              strokeWidth={1.5}
              label={{ value: '📌', position: 'top', fontSize: 12 }}
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
          📌 아이콘이 있는 날짜는 메모가 저장된 일자입니다. 마우스를 올려 내용을 확인하거나 클릭해
          수정할 수 있습니다.
        </p>
      )}
    </div>
  )
}
