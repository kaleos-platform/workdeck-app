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
  type DisplayChannel,
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

const formatOrders = (n: number) => `${n.toLocaleString('ko-KR')}건`

/**
 * 채널당 1행 툴팁.
 * - 값이 0인 채널은 숨긴다 (채널 수만큼 ₩0 행이 쌓여 차트 밖까지 넘치던 문제)
 * - 합계는 "선택된 채널" 기준 → 화면 스택 높이·하단 피벗 테이블 합계와 일치
 */
function ChannelTooltip({
  active,
  payload,
  label,
  visibleChannels,
  metric,
}: {
  active?: boolean
  payload?: { payload: ChartRow }[]
  label?: string
  visibleChannels: DisplayChannel[]
  metric: Metric
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const showRev = metric === '매출' || metric === '매출+주문'
  const showOrd = metric === '주문' || metric === '매출+주문'

  const rows = visibleChannels.map((dc) => ({
    dc,
    revenue: Number(row[dc.id] ?? 0),
    orderCount: Number(row[ordKey(dc.id)] ?? 0),
  }))
  // 합계는 필터 전 전체 선택 채널 기준
  const total = rows.reduce(
    (acc, r) => ({ revenue: acc.revenue + r.revenue, orderCount: acc.orderCount + r.orderCount }),
    { revenue: 0, orderCount: 0 }
  )
  const visibleRows = rows.filter((r) =>
    metric === '매출' ? r.revenue !== 0 : metric === '주문' ? r.orderCount !== 0 : r.revenue !== 0 || r.orderCount !== 0
  )

  const valueText = (v: { revenue: number; orderCount: number }) =>
    showRev && showOrd
      ? `${formatKRW(v.revenue)} / ${formatOrders(v.orderCount)}`
      : showRev
        ? formatKRW(v.revenue)
        : formatOrders(v.orderCount)

  return (
    <div className="max-h-[200px] min-w-[180px] space-y-1 overflow-y-auto rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-muted-foreground">{label}</p>
      <div className="space-y-0.5 tabular-nums">
        {visibleRows.map((r) => (
          <p key={r.dc.id} className="flex justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: r.dc.color }}
              />
              <span className="text-muted-foreground">{r.dc.name}</span>
            </span>
            <span>{valueText(r)}</span>
          </p>
        ))}
        <p className="flex justify-between gap-3 border-t pt-0.5">
          <span className="text-muted-foreground">합계</span>
          <span className="font-semibold">{valueText(total)}</span>
        </p>
      </div>
    </div>
  )
}

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
                allowEscapeViewBox={{ x: false, y: false }}
                wrapperStyle={{ zIndex: 50 }}
                content={
                  (<ChannelTooltip visibleChannels={visibleChannels} metric={metric} />) as never
                }
              />
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
