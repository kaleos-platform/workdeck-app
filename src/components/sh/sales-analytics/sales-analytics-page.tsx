'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  lastClosedDateKst,
  last30DaysRange,
  startOfWeekMon,
  startOfMonth,
  endOfMonth,
  addDaysYmd,
  addMonthsYmd,
  type DateRange,
  type SalesUnit,
} from '@/lib/sh/sales-analytics'
import { useSalesAnalysis } from '@/hooks/use-sales-analysis'
import { SalesPivotTable } from './sales-pivot-table'
import { ChannelRevenueStackedChart } from './channel-revenue-stacked-chart'

export type Channel = { id: string; name: string; typeName: string }

const UNITS: SalesUnit[] = ['일', '주', '월']
const ALL_TYPES = 'ALL'

// ─── 퀵필터 (기간만 변경 — 표시 단위와 독립) ─────────────────────────────────
type QuickFilter = { label: string; range: () => DateRange }

/** 최근 N개월: (N-1)개월 전 시작월 1일 ~ 마지막 집계일 */
function lastNMonthsRange(n: number): DateRange {
  const anchor = lastClosedDateKst()
  return { from: startOfMonth(addMonthsYmd(anchor, -(n - 1))), to: anchor }
}

const QUICK_FILTERS: QuickFilter[] = [
  { label: '최근 30일', range: last30DaysRange },
  {
    label: '이번달',
    range: () => {
      const anchor = lastClosedDateKst()
      return { from: startOfMonth(anchor), to: anchor }
    },
  },
  {
    label: '지난달',
    range: () => {
      const prevMonthEnd = addDaysYmd(startOfMonth(lastClosedDateKst()), -1)
      return { from: startOfMonth(prevMonthEnd), to: endOfMonth(prevMonthEnd) }
    },
  },
  { label: '최근 3개월', range: () => lastNMonthsRange(3) },
  { label: '최근 6개월', range: () => lastNMonthsRange(6) },
  { label: '최근 12개월', range: () => lastNMonthsRange(12) },
  {
    label: '올해',
    range: () => {
      const anchor = lastClosedDateKst()
      const year = anchor.slice(0, 4)
      return { from: `${year}-01-01`, to: anchor }
    },
  },
  {
    label: '작년',
    range: () => {
      const year = Number(lastClosedDateKst().slice(0, 4)) - 1
      return { from: `${year}-01-01`, to: `${year}-12-31` }
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
  const [unit, setUnit] = useState<SalesUnit>('일')
  const [range, setRange] = useState<DateRange>(() => last30DaysRange())
  const [channels, setChannels] = useState<Channel[]>([])
  const [typeFilter, setTypeFilter] = useState<string>(ALL_TYPES)
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set())

  // 판매채널만 로드
  useEffect(() => {
    fetch('/api/channels?isSalesChannel=true&isActive=true')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: Channel[] = (d?.channels ?? []).map(
          (c: { id: string; name: string; channelTypeDef?: { name?: string } | null }) => ({
            id: c.id,
            name: c.name,
            typeName: c.channelTypeDef?.name ?? '기타',
          })
        )
        setChannels(list)
        setSelectedChannelIds(new Set(list.map((c) => c.id)))
      })
      .catch(() => {})
  }, [])

  // 유형 옵션 (distinct typeName, 정렬)
  const typeOptions = useMemo(
    () => Array.from(new Set(channels.map((c) => c.typeName))).sort(),
    [channels]
  )

  // 유형필터 통과 채널
  const typedChannels = useMemo(
    () => (typeFilter === ALL_TYPES ? channels : channels.filter((c) => c.typeName === typeFilter)),
    [channels, typeFilter]
  )

  // 표시 대상 채널 = 유형필터 통과 ∩ 선택 (차트·테이블 공통)
  const visibleChannels = useMemo(
    () => typedChannels.filter((c) => selectedChannelIds.has(c.id)),
    [typedChannels, selectedChannelIds]
  )

  // 데이터 호출은 판매채널 전체 기준 (buckets 에 채널별 다 담김). 표시만 visibleChannels 로 필터.
  const allChannelIds = useMemo(() => channels.map((c) => c.id), [channels])
  const data = useSalesAnalysis(unit, range, allChannelIds)

  function changeUnit(next: SalesUnit) {
    setUnit(next) // 단위만 변경, 기간 유지
  }

  function applyQuickFilter(qf: QuickFilter) {
    setRange(snapRangeToUnit(unit, qf.range()))
  }

  function changeDate(key: 'from' | 'to', value: string) {
    if (!value) return
    setRange((r) => snapRangeToUnit(unit, { ...r, [key]: value }))
  }

  function changeTypeFilter(next: string) {
    setTypeFilter(next)
    // 유형 변경 시 해당 유형 전체 채널을 선택으로 리셋
    const inType = next === ALL_TYPES ? channels : channels.filter((c) => c.typeName === next)
    setSelectedChannelIds(new Set(inType.map((c) => c.id)))
  }

  function toggleChannel(id: string) {
    setSelectedChannelIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    const allSelected = typedChannels.every((c) => selectedChannelIds.has(c.id))
    setSelectedChannelIds((prev) => {
      const next = new Set(prev)
      if (allSelected) typedChannels.forEach((c) => next.delete(c.id))
      else typedChannels.forEach((c) => next.add(c.id))
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

      {/* 컨트롤 바 — 좌: 단위·날짜 / 우: 퀵필터 (높이 절약) */}
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-6">
          {/* 좌측: 유형 + 단위 토글 + 날짜 */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">채널 유형</Label>
              <Select value={typeFilter} onValueChange={changeTypeFilter}>
                <SelectTrigger className="w-32" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TYPES}>전체</SelectItem>
                  {typeOptions.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
          {/* 우측: 퀵필터 */}
          <div className="flex flex-wrap justify-end gap-1">
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
        buckets={data.buckets}
        typedChannels={typedChannels}
        selectedChannelIds={selectedChannelIds}
        onToggleChannel={toggleChannel}
        onToggleAll={toggleAll}
        loading={data.loading}
      />

      {/* 테이블 매트릭스 */}
      <SalesPivotTable
        buckets={data.buckets}
        visibleChannels={visibleChannels}
        loading={data.loading}
      />
    </div>
  )
}
