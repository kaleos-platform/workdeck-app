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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BarChart3, TableIcon } from 'lucide-react'
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

const KEY_TO_TYPE: Record<string, string> = {
  inbound: 'INBOUND',
  outbound: 'OUTBOUND',
  return: 'RETURN',
  transfer: 'TRANSFER',
  adjustment: 'ADJUSTMENT',
}

function buildQuery(filters: DashboardFilterValues) {
  const p = new URLSearchParams()
  if (filters.locationId) p.set('locationId', filters.locationId)
  if (filters.channelId) p.set('channelId', filters.channelId)
  if (filters.from) p.set('from', filters.from)
  if (filters.to) p.set('to', filters.to)
  if (filters.movementTypes?.length) p.set('movementTypes', filters.movementTypes.join(','))
  const s = p.toString()
  return s ? `?${s}` : ''
}

function formatDateLabel(ymd: string): string {
  const parts = ymd.split('-')
  if (parts.length !== 3) return ymd
  return `${parts[1]}/${parts[2]}`
}

type ViewMode = 'table' | 'chart'

export function DashboardChart({ filters }: Props) {
  const [data, setData] = useState<TimeseriesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('table')

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)

    setError(null)
    fetch(`/api/sh/inventory/dashboard/timeseries${buildQuery(filters)}`)
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
  }, [filters])

  const chartData = useMemo(
    () =>
      (data?.series ?? []).map((row) => ({
        ...row,
        label: formatDateLabel(row.date),
      })),
    [data]
  )

  const visibleLines = filters.movementTypes?.length
    ? LINES.filter((ln) => filters.movementTypes!.includes(KEY_TO_TYPE[ln.key]))
    : LINES

  const totalMovements = chartData.reduce(
    (sum, row) => sum + row.inbound + row.outbound + row.return + row.transfer + row.adjustment,
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
          <div className="flex gap-1 rounded-lg border p-0.5">
            <Button
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2.5"
              onClick={() => setViewMode('table')}
            >
              <TableIcon className="mr-1 h-3.5 w-3.5" />
              테이블
            </Button>
            <Button
              variant={viewMode === 'chart' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2.5"
              onClick={() => setViewMode('chart')}
            >
              <BarChart3 className="mr-1 h-3.5 w-3.5" />
              그래프
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="h-72 w-full animate-pulse rounded bg-muted" />
        ) : error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : totalMovements === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
            <BarChart3 className="h-12 w-12 opacity-30" />
            <p className="text-sm">선택한 기간에 이동 내역이 없습니다</p>
          </div>
        ) : viewMode === 'table' ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-background">날짜</TableHead>
                  {visibleLines.map((ln) => (
                    <TableHead key={ln.key} className="text-right">
                      <span style={{ color: ln.color }}>{ln.label}</span>
                    </TableHead>
                  ))}
                  <TableHead className="text-right font-semibold">합계</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chartData.map((row) => {
                  const r = row as unknown as Record<string, number>
                  let rowTotal = 0
                  for (const ln of visibleLines) rowTotal += r[ln.key] ?? 0
                  return (
                    <TableRow key={row.date}>
                      <TableCell className="sticky left-0 bg-background text-sm whitespace-nowrap">
                        {row.date}
                      </TableCell>
                      {visibleLines.map((ln) => {
                        const val = (row as unknown as Record<string, number>)[ln.key]
                        return (
                          <TableCell key={ln.key} className="text-right tabular-nums">
                            {val === 0 ? (
                              <span className="text-muted-foreground">-</span>
                            ) : (
                              val.toLocaleString()
                            )}
                          </TableCell>
                        )
                      })}
                      <TableCell className="text-right font-medium tabular-nums">
                        {rowTotal === 0 ? '-' : rowTotal.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {/* Total row */}
                <TableRow className="bg-muted/50 font-medium">
                  <TableCell className="sticky left-0 bg-muted/50 text-sm font-semibold">
                    합계
                  </TableCell>
                  {visibleLines.map((ln) => {
                    let colTotal = 0
                    for (const row of chartData)
                      colTotal += (row as unknown as Record<string, number>)[ln.key] ?? 0
                    return (
                      <TableCell key={ln.key} className="text-right font-semibold tabular-nums">
                        {colTotal === 0 ? '-' : colTotal.toLocaleString()}
                      </TableCell>
                    )
                  })}
                  <TableCell className="text-right font-semibold tabular-nums">
                    {totalMovements.toLocaleString()}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
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
              {visibleLines.map((ln) => (
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
