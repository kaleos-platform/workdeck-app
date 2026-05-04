'use client'

import { useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { DailyMetricRow } from '@/lib/sc/metrics-types'

// ─── 지표 정의 ────────────────────────────────────────────────────────────────

type Metric = 'views' | 'impressions' | 'likes' | 'comments' | 'externalClicks'

const METRIC_OPTIONS: Array<{ key: Metric; label: string }> = [
  { key: 'views', label: '조회' },
  { key: 'impressions', label: '노출' },
  { key: 'likes', label: '좋아요' },
  { key: 'comments', label: '댓글' },
  { key: 'externalClicks', label: '외부 클릭' },
]

// ─── X축 날짜 포맷 ─────────────────────────────────────────────────────────

function formatXDate(dateStr: string): string {
  // YYYY-MM-DD → MM-DD
  return dateStr.slice(5)
}

// ─── Tooltip 포맷 ─────────────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{label}</p>
      <p className="text-muted-foreground tabular-nums">{payload[0].value.toLocaleString()}</p>
    </div>
  )
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────

interface ContentMetricsChartProps {
  daily: DailyMetricRow[]
}

export function ContentMetricsChart({ daily }: ContentMetricsChartProps) {
  const [metric, setMetric] = useState<Metric>('views')

  // 데이터 없거나 전부 0 이면 플레이스홀더
  const hasData = daily.length > 0 && daily.some((d) => d[metric] > 0)

  return (
    <div className="space-y-3">
      {/* 지표 선택 버튼 그룹 */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="지표 선택">
        {METRIC_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setMetric(opt.key)}
            aria-pressed={metric === opt.key}
            className={[
              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
              metric === opt.key
                ? 'bg-primary text-primary-foreground'
                : 'border text-muted-foreground hover:border-primary/40 hover:text-foreground',
            ].join(' ')}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 차트 영역 */}
      {!hasData ? (
        <div className="flex h-[180px] items-center justify-center rounded-md border border-dashed">
          <p className="text-sm text-muted-foreground">데이터가 부족합니다.</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={daily} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/60" />
            <XAxis
              dataKey="date"
              tickFormatter={formatXDate}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              className="text-muted-foreground"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'currentColor' }}
              className="text-muted-foreground"
              tickLine={false}
              axisLine={false}
              width={36}
              tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey={metric}
              stroke="currentColor"
              className="text-primary"
              dot={false}
              strokeWidth={2}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
