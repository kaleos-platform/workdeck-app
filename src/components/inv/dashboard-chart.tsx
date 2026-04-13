'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BarChart3 } from 'lucide-react'
import { getLastNDaysRangeKst } from '@/lib/date-range'
import type { DashboardFilterValues } from './dashboard-filters'

interface Props {
  filters: DashboardFilterValues
}

type SeriesRow = {
  date: string
  inbound: number
  outbound: number
  return: number
  transfer: number
  adjustment: number
}

type TimeseriesResponse = {
  series: SeriesRow[]
  from: string
  to: string
  granularity: 'day' | 'week' | 'month'
}

const LINES = [
  { key: 'inbound', label: '입고', color: '#16a34a' },
  { key: 'outbound', label: '출고', color: '#dc2626' },
  { key: 'return', label: '반품', color: '#2563eb' },
  { key: 'transfer', label: '이동', color: '#ca8a04' },
  { key: 'adjustment', label: '조정', color: '#9333ea' },
] as const

function buildQuery(filters: DashboardFilterValues, fallback?: { from: string; to: string }) {
  const p = new URLSearchParams()
  if (filters.locationId) p.set('locationId', filters.locationId)
  if (filters.channelId) p.set('channelId', filters.channelId)
  if (filters.channelGroupId) p.set('channelGroupId', filters.channelGroupId)
  const from = filters.from ?? fallback?.from
  const to = filters.to ?? fallback?.to
  if (from) p.set('from', from)
  if (to) p.set('to', to)
  const s = p.toString()
  return s ? `?${s}` : ''
}

function formatDateLabel(ymd: string): string {
  const parts = ymd.split('-')
  if (parts.length !== 3) return ymd
  return `${parts[1]}/${parts[2]}`
}

export function DashboardChart({ filters }: Props) {
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30)
  const [data, setData] = useState<TimeseriesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const effectiveRange = useMemo(() => getLastNDaysRangeKst(rangeDays), [rangeDays])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/inv/dashboard/timeseries${buildQuery(filters, effectiveRange)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string }
          throw new Error(body.message ?? '차트 데이터를 불러오지 못했습니다')
        }
        return (await res.json()) as TimeseriesResponse
      })
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filters, effectiveRange])

  const chartData = useMemo(
    () =>
      (data?.series ?? []).map((row) => ({
        ...row,
        label: formatDateLabel(row.date),
      })),
    [data]
  )

  const totalMovements = chartData.reduce(
    (sum, row) =>
      sum + row.inbound + row.outbound + row.return + row.transfer + row.adjustment,
    0
  )

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">재고 이동 추이</p>
            <p className="text-xs text-muted-foreground">
              {data ? `${data.from} ~ ${data.to}` : '기간 불러오는 중...'}
            </p>
          </div>
          <div className="flex gap-1">
            {[7, 30, 90].map((n) => (
              <Button
                key={n}
                variant={rangeDays === n ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRangeDays(n as 7 | 30 | 90)}
                disabled={Boolean(filters.from || filters.to)}
              >
                {n}일
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="h-72 w-full animate-pulse rounded bg-muted" />
        ) : error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : totalMovements === 0 ? (
          <div className="flex h-72 flex-col items-center justify-center gap-3 text-muted-foreground">
            <BarChart3 className="h-12 w-12 opacity-30" />
            <p className="text-sm">선택한 기간에 이동 내역이 없습니다</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                  backgroundColor: 'hsl(var(--background))',
                }}
                labelFormatter={(label, payload) => {
                  const row = payload?.[0]?.payload as (SeriesRow & { label: string }) | undefined
                  return row?.date ?? label
                }}
                formatter={(value, name) => [
                  `${Number(value ?? 0).toLocaleString()} 개`,
                  String(name ?? ''),
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {LINES.map((ln) => (
                <Line
                  key={ln.key}
                  dataKey={ln.key}
                  name={ln.label}
                  type="monotone"
                  stroke={ln.color}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
