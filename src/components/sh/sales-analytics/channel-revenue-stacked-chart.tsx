'use client'

import { useMemo, useState } from 'react'
import {
  ComposedChart,
  Bar,
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
import {
  bucketValueFor,
  formatKRW,
  resolveDisplayChannels,
  type RevenueBucket,
} from '@/lib/sh/sales-analytics'

type TypedChannel = { id: string; name: string }

type Props = {
  buckets: RevenueBucket[]
  typedChannels: TypedChannel[]
  selectedChannelIds: Set<string>
  onToggleChannel: (id: string) => void
  onToggleAll: () => void
  loading: boolean
}

type ChartRow = { label: string; [key: string]: string | number }

/** 주문 라인 dataKey prefix (채널 id 충돌 방지) */
const ORD_PREFIX = 'ord_'
const ordKey = (id: string) => `${ORD_PREFIX}${id}`

type Metric = '매출' | '주문' | '매출+주문'
const METRICS: Metric[] = ['매출', '주문', '매출+주문']

export function ChannelRevenueStackedChart({
  buckets,
  typedChannels,
  selectedChannelIds,
  onToggleChannel,
  onToggleAll,
  loading,
}: Props) {
  const [metric, setMetric] = useState<Metric>('매출')

  // 정렬·색상 — 유형 통과 전체 채널 기준 (체크박스 표시용)
  const displayChannels = useMemo(
    () => resolveDisplayChannels(typedChannels, buckets),
    [typedChannels, buckets]
  )
  // 차트에 그릴 채널 = 선택된 것 (로켓 포함 전부 주문 기준)
  const visibleChannels = useMemo(
    () => displayChannels.filter((dc) => selectedChannelIds.has(dc.id)),
    [displayChannels, selectedChannelIds]
  )

  const showBars = metric === '매출' || metric === '매출+주문'
  const showLines = metric === '주문' || metric === '매출+주문'

  const chartData = useMemo<ChartRow[]>(() => {
    return buckets.map((b) => {
      const row: ChartRow = { label: b.label }
      for (const dc of visibleChannels) {
        const v = bucketValueFor(b, dc.id)
        row[dc.id] = v.revenue
        row[ordKey(dc.id)] = v.orderCount
      }
      return row
    })
  }, [buckets, visibleChannels])

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    displayChannels.forEach((dc) => {
      m.set(dc.id, dc.name)
      m.set(ordKey(dc.id), `${dc.name} 주문`)
    })
    return m
  }, [displayChannels])

  const allSelected =
    typedChannels.length > 0 && typedChannels.every((c) => selectedChannelIds.has(c.id))

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <CardTitle>채널별 매출·주문 추이</CardTitle>
          {/* 메트릭 토글 */}
          <div className="flex gap-1">
            {METRICS.map((m) => (
              <Button
                key={m}
                variant={metric === m ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMetric(m)}
              >
                {m}
              </Button>
            ))}
          </div>
        </div>
        {/* 채널 선택/제외 + 전체 */}
        {typedChannels.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <div className="flex items-center gap-1.5">
              <Checkbox id="sa-ch-all" checked={allSelected} onCheckedChange={onToggleAll} />
              <Label htmlFor="sa-ch-all" className="cursor-pointer text-xs font-medium">
                전체
              </Label>
            </div>
            {displayChannels.map((dc) => (
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
        ) : chartData.length === 0 || visibleChannels.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            {visibleChannels.length === 0
              ? '표시할 채널을 선택하세요'
              : '해당 기간에 매출 데이터가 없습니다'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              {/* 좌축: 매출 */}
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) =>
                  v >= 1000000
                    ? `${(v / 1000000).toFixed(1)}M`
                    : v >= 1000
                      ? `${(v / 1000).toFixed(0)}K`
                      : String(v)
                }
              />
              {/* 우축: 주문건수 */}
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => v.toLocaleString('ko-KR')}
              />
              <Tooltip
                formatter={
                  ((value: number | string | undefined, name: string | number | undefined) => {
                    const num = typeof value === 'number' ? value : Number(value ?? 0)
                    const key = String(name ?? '')
                    const display = nameById.get(key) ?? key
                    if (key.startsWith(ORD_PREFIX)) {
                      return [`${num.toLocaleString('ko-KR')}건`, display] as [string, string]
                    }
                    return [formatKRW(num), display] as [string, string]
                  }) as never
                }
              />
              <Legend formatter={(value) => nameById.get(String(value)) ?? String(value)} />
              {showBars &&
                visibleChannels.map((dc) => (
                  <Bar key={dc.id} yAxisId="left" dataKey={dc.id} stackId="rev" fill={dc.color} />
                ))}
              {showLines &&
                visibleChannels.map((dc) => (
                  <Line
                    key={ordKey(dc.id)}
                    yAxisId="right"
                    type="monotone"
                    dataKey={ordKey(dc.id)}
                    stroke={dc.color}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                  />
                ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
