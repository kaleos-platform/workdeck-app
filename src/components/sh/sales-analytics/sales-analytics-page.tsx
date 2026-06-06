'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  defaultRangeForUnit,
  lastClosedDateKst,
  startOfWeekMon,
  startOfMonth,
  endOfMonth,
  addDaysYmd,
  type DateRange,
  type SalesUnit,
} from '@/lib/sh/sales-analytics'
import { useSalesAnalysis } from '@/hooks/use-sales-analysis'
import { SalesPivotTable } from './sales-pivot-table'
import { ChannelRevenueStackedChart } from './channel-revenue-stacked-chart'

type Channel = { id: string; name: string }

const UNITS: SalesUnit[] = ['일', '주', '월']

// ─── 퀵필터 (사용자 명시 3종: 지난주/이번달/지난달) ──────────────────────────
type QuickFilter = { label: string; unit: SalesUnit; range: () => DateRange }

const QUICK_FILTERS: QuickFilter[] = [
  {
    label: '지난주',
    unit: '주',
    range: () => {
      const thisMonday = startOfWeekMon(lastClosedDateKst())
      const lastMonday = addDaysYmd(thisMonday, -7)
      return { from: lastMonday, to: addDaysYmd(lastMonday, 6) }
    },
  },
  {
    label: '이번달',
    unit: '월',
    range: () => {
      const anchor = lastClosedDateKst()
      return { from: startOfMonth(anchor), to: anchor }
    },
  },
  {
    label: '지난달',
    unit: '월',
    range: () => {
      const prevMonthEnd = addDaysYmd(startOfMonth(lastClosedDateKst()), -1)
      return { from: startOfMonth(prevMonthEnd), to: endOfMonth(prevMonthEnd) }
    },
  },
]

/** 임의 날짜를 현재 단위 경계로 스냅 (from=경계 시작) */
function snapRangeToUnit(unit: SalesUnit, range: DateRange): DateRange {
  if (unit === '주') return { from: startOfWeekMon(range.from), to: range.to }
  if (unit === '월') return { from: startOfMonth(range.from), to: range.to }
  return range
}

export function SalesAnalyticsPage() {
  const [unit, setUnit] = useState<SalesUnit>('주')
  const [range, setRange] = useState<DateRange>(() => defaultRangeForUnit('주'))
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set())

  // 판매채널만 로드
  useEffect(() => {
    fetch('/api/channels?isSalesChannel=true&isActive=true')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: Channel[] = (d?.channels ?? []).map((c: { id: string; name: string }) => ({
          id: c.id,
          name: c.name,
        }))
        setChannels(list)
        setSelectedChannelIds(new Set(list.map((c) => c.id)))
      })
      .catch(() => {})
  }, [])

  const allChannelIds = useMemo(() => channels.map((c) => c.id), [channels])

  // 데이터: channelIds 는 "판매채널 전체"(집계 대상). 화면 표시 채널은 selectedChannelIds 로 차트에서 필터.
  const data = useSalesAnalysis(unit, range, allChannelIds)

  function changeUnit(next: SalesUnit) {
    setUnit(next)
    setRange(defaultRangeForUnit(next))
  }

  function applyQuickFilter(qf: QuickFilter) {
    setUnit(qf.unit)
    setRange(qf.range())
  }

  function changeDate(key: 'from' | 'to', value: string) {
    if (!value) return
    setRange((r) => snapRangeToUnit(unit, { ...r, [key]: value }))
  }

  function toggleChannel(id: string) {
    setSelectedChannelIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const dataAsOf = lastClosedDateKst()

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">판매분석</h1>
          <p className="text-sm text-muted-foreground">
            채널별 매출·주문 현황과 일·주·월 단위 증감을 분석합니다
          </p>
        </div>
        <p className="text-xs text-muted-foreground">데이터 기준일: {dataAsOf}</p>
      </div>

      {/* 컨트롤 바 */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex flex-wrap items-end gap-4">
            {/* 단위 토글 */}
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">표시 단위</Label>
              <div className="flex gap-1">
                {UNITS.map((u) => (
                  <Button
                    key={u}
                    variant={unit === u ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => changeUnit(u)}
                  >
                    {u}
                  </Button>
                ))}
              </div>
            </div>
            {/* 날짜 직접 선택 */}
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">시작일</Label>
              <Input
                type="date"
                value={range.from}
                max={range.to}
                onChange={(e) => changeDate('from', e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">종료일</Label>
              <Input
                type="date"
                value={range.to}
                min={range.from}
                max={dataAsOf}
                onChange={(e) => changeDate('to', e.target.value)}
                className="w-40"
              />
            </div>
          </div>
          {/* 퀵필터 */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">퀵필터:</span>
            {QUICK_FILTERS.map((qf) => (
              <Button
                key={qf.label}
                variant="outline"
                size="sm"
                onClick={() => applyQuickFilter(qf)}
              >
                {qf.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 차트 */}
      <ChannelRevenueStackedChart
        unit={unit}
        buckets={data.buckets}
        channels={channels}
        selectedChannelIds={selectedChannelIds}
        onToggleChannel={toggleChannel}
        loading={data.loading}
      />

      {/* 테이블 매트릭스 */}
      <SalesPivotTable
        unit={unit}
        buckets={data.buckets}
        channels={channels}
        channelTotals={data.channelTotals}
        currentTotals={data.currentTotals}
        prevTotals={data.prevTotals}
        loading={data.loading}
      />
    </div>
  )
}
