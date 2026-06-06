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
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  bucketValueFor,
  formatKRW,
  resolveDisplayChannels,
  type RevenueBucket,
  type SalesUnit,
} from '@/lib/sh/sales-analytics'

type Channel = { id: string; name: string }

type Props = {
  unit: SalesUnit
  buckets: RevenueBucket[]
  channels: Channel[]
  selectedChannelIds: Set<string>
  onToggleChannel: (id: string) => void
  loading: boolean
}

type ChartRow = { label: string; [channelId: string]: string | number }

export function ChannelRevenueStackedChart({
  buckets,
  channels,
  selectedChannelIds,
  onToggleChannel,
  loading,
}: Props) {
  const displayChannels = useMemo(
    () => resolveDisplayChannels(channels, buckets),
    [channels, buckets]
  )

  // 차트 데이터: 버킷 = 행, 표시 채널 = dataKey
  const chartData = useMemo<ChartRow[]>(() => {
    return buckets.map((b) => {
      const row: ChartRow = { label: b.label }
      for (const dc of displayChannels) {
        row[dc.id] = bucketValueFor(b, dc, displayChannels).revenue
      }
      return row
    })
  }, [buckets, displayChannels])

  // 차트에 그릴 채널 = 선택된 것. "기타"는 개별 토글 없으므로 항상 표시.
  const visibleChannels = displayChannels.filter(
    (dc) => dc.isOther || selectedChannelIds.has(dc.id)
  )

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    displayChannels.forEach((dc) => m.set(dc.id, dc.name))
    return m
  }, [displayChannels])

  return (
    <Card>
      <CardHeader>
        <CardTitle>채널별 매출 추이</CardTitle>
        {/* 채널 선택/제외 (기타 제외) */}
        {displayChannels.length > 0 && (
          <div className="flex flex-wrap gap-3 pt-1">
            {displayChannels
              .filter((dc) => !dc.isOther)
              .map((dc) => (
                <div key={dc.id} className="flex items-center gap-1.5">
                  <Checkbox
                    id={`sa-ch-${dc.id}`}
                    checked={selectedChannelIds.has(dc.id)}
                    onCheckedChange={() => onToggleChannel(dc.id)}
                  />
                  <Label
                    htmlFor={`sa-ch-${dc.id}`}
                    className="cursor-pointer text-xs"
                    style={{ color: dc.color }}
                  >
                    {dc.name}
                  </Label>
                </div>
              ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            불러오는 중...
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            해당 기간에 매출 데이터가 없습니다
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
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
                formatter={
                  ((value: number | string | undefined, name: string | number | undefined) => {
                    const num = typeof value === 'number' ? value : Number(value ?? 0)
                    return [
                      formatKRW(num),
                      nameById.get(String(name ?? '')) ?? String(name ?? ''),
                    ] as [string, string]
                  }) as never
                }
              />
              <Legend formatter={(value) => nameById.get(String(value)) ?? String(value)} />
              {visibleChannels.map((dc) => (
                <Bar key={dc.id} dataKey={dc.id} stackId="rev" fill={dc.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
