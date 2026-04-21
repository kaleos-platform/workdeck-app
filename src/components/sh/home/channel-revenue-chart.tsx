'use client'

import { useCallback, useEffect, useState } from 'react'
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
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { getLastNDaysRangeKst } from '@/lib/date-range'

type Channel = {
  id: string
  name: string
}

type RevenueRow = {
  date: string
  channelId: string
  channelName: string
  totalRevenue: number
  totalOrders: number
}

type ChartDataPoint = {
  date: string
  [channelId: string]: string | number
}

// 기간 프리셋 정의
const PERIOD_OPTIONS = [
  { label: '7일', days: 7 },
  { label: '30일', days: 30 },
  { label: '이번달', days: 0 },
] as const

type PeriodKey = '7일' | '30일' | '이번달'

function getPeriodRange(label: PeriodKey): { from: string; to: string } {
  if (label === '이번달') {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    return {
      from: `${year}-${month}-01`,
      to: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
    }
  }
  const opt = PERIOD_OPTIONS.find((o) => o.label === label)
  return getLastNDaysRangeKst(opt?.days ?? 7)
}

// 채널별 색상 팔레트
const COLORS = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#be185d',
  '#65a30d',
  '#ea580c',
  '#4338ca',
]

export function ChannelRevenueChart() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set())
  const [period, setPeriod] = useState<PeriodKey>('30일')
  const [chartData, setChartData] = useState<ChartDataPoint[]>([])
  const [loading, setLoading] = useState(false)

  // 채널 목록 로드
  useEffect(() => {
    fetch('/api/channels')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const list: Channel[] = data?.channels ?? []
        setChannels(list)
        // 기본으로 전체 채널 선택
        setSelectedChannelIds(new Set(list.map((c) => c.id)))
      })
      .catch(() => {})
  }, [])

  // 매출 데이터 로드
  const fetchRevenue = useCallback(async () => {
    if (channels.length === 0) return
    setLoading(true)
    try {
      const { from, to } = getPeriodRange(period)
      const params = new URLSearchParams({ from, to, groupBy: 'date' })
      const res = await fetch(`/api/sh/dashboard/revenue?${params.toString()}`)
      if (!res.ok) return
      const data = await res.json()
      const rows: RevenueRow[] = data.rows ?? data.daily ?? []

      // 날짜 × 채널 구조로 변환
      const byDate: Record<string, ChartDataPoint> = {}
      rows.forEach((row) => {
        if (!byDate[row.date]) byDate[row.date] = { date: row.date }
        byDate[row.date][row.channelId] = row.totalRevenue
      })

      // 날짜 정렬
      const sorted = Object.values(byDate).sort((a, b) =>
        String(a.date).localeCompare(String(b.date))
      )
      setChartData(sorted)
    } finally {
      setLoading(false)
    }
  }, [channels.length, period])

  useEffect(() => {
    void fetchRevenue()
  }, [fetchRevenue])

  const toggleChannel = (channelId: string) => {
    setSelectedChannelIds((prev) => {
      const next = new Set(prev)
      if (next.has(channelId)) {
        next.delete(channelId)
      } else {
        next.add(channelId)
      }
      return next
    })
  }

  const visibleChannels = channels.filter((c) => selectedChannelIds.has(c.id))

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <CardTitle>채널별 매출 추이</CardTitle>
          {/* 기간 필터 */}
          <div className="flex gap-1">
            {PERIOD_OPTIONS.map((opt) => (
              <Button
                key={opt.label}
                variant={period === opt.label ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPeriod(opt.label as PeriodKey)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>
        {/* 채널 다중 선택 */}
        {channels.length > 0 && (
          <div className="flex flex-wrap gap-3 pt-1">
            {channels.map((channel, idx) => (
              <div key={channel.id} className="flex items-center gap-1.5">
                <Checkbox
                  id={`ch-${channel.id}`}
                  checked={selectedChannelIds.has(channel.id)}
                  onCheckedChange={() => toggleChannel(channel.id)}
                />
                <Label
                  htmlFor={`ch-${channel.id}`}
                  className="cursor-pointer text-xs"
                  style={{ color: COLORS[idx % COLORS.length] }}
                >
                  {channel.name}
                </Label>
              </div>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            불러오는 중...
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            해당 기간에 매출 데이터가 없습니다
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => String(v).slice(5)} // MM-DD
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) =>
                  v >= 1000000
                    ? `${(v / 1000000).toFixed(1)}M`
                    : v >= 1000
                      ? `${(v / 1000).toFixed(0)}K`
                      : String(v)
                }
              />
              <Tooltip
                formatter={(value: number | undefined, name: string | undefined) => {
                  const channel = channels.find((c) => c.id === name)
                  return [
                    new Intl.NumberFormat('ko-KR', {
                      style: 'currency',
                      currency: 'KRW',
                      maximumFractionDigits: 0,
                    }).format(value ?? 0),
                    channel?.name ?? name ?? '',
                  ]
                }}
              />
              <Legend
                formatter={(value) => {
                  const channel = channels.find((c) => c.id === value)
                  return channel?.name ?? value
                }}
              />
              {visibleChannels.map((channel) => (
                <Line
                  key={channel.id}
                  type="monotone"
                  dataKey={channel.id}
                  stroke={COLORS[channels.findIndex((c) => c.id === channel.id) % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
