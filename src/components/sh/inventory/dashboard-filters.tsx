'use client'

import { useEffect, useState } from 'react'
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
import { getLastNDaysRangeKst, getTodayStrKst } from '@/lib/date-range'

export type DashboardFilterValues = {
  locationId?: string
  channelId?: string
  channelGroupId?: string
  from?: string
  to?: string
  movementTypes?: string[]
}

interface Props {
  value: DashboardFilterValues
  onChange: (next: DashboardFilterValues) => void
}

type Location = { id: string; name: string }
type Channel = { id: string; name: string }
type ChannelGroup = { id: string; name: string }

const ALL = '__all__'

export function DashboardFilters({ value, onChange }: Props) {
  const [locations, setLocations] = useState<Location[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [groups, setGroups] = useState<ChannelGroup[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [locRes, chRes, grpRes] = await Promise.all([
          fetch('/api/inv/locations?isActive=true'),
          fetch('/api/inv/channels?isActive=true'),
          fetch('/api/inv/channel-groups'),
        ])
        if (cancelled) return
        if (locRes.ok) {
          const j = (await locRes.json()) as { locations: Location[] }
          setLocations(j.locations ?? [])
        }
        if (chRes.ok) {
          const j = (await chRes.json()) as { channels: Channel[] }
          setChannels(j.channels ?? [])
        }
        if (grpRes.ok) {
          const j = (await grpRes.json()) as { groups: ChannelGroup[] }
          setGroups(j.groups ?? [])
        }
      } catch {
        // ignore
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  function update<K extends keyof DashboardFilterValues>(key: K, next: DashboardFilterValues[K]) {
    onChange({ ...value, [key]: next })
  }

  function reset() {
    const range = getLastNDaysRangeKst(7)
    onChange({ from: range.from, to: range.to })
  }

  // --- Quick-select helpers ---
  function getThisMonthRange(): { from: string; to: string } {
    const today = getTodayStrKst()
    const [y, m] = today.split('-').map(Number)
    const from = `${y}-${String(m).padStart(2, '0')}-01`
    return { from, to: today }
  }

  function getLastMonthRange(): { from: string; to: string } {
    const today = getTodayStrKst()
    const [y, m] = today.split('-').map(Number)
    const prevM = m === 1 ? 12 : m - 1
    const prevY = m === 1 ? y - 1 : y
    const from = `${prevY}-${String(prevM).padStart(2, '0')}-01`
    const lastDay = new Date(y, m - 1, 0).getDate()
    const to = `${prevY}-${String(prevM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    return { from, to }
  }

  const range7 = getLastNDaysRangeKst(7)
  const range30 = getLastNDaysRangeKst(30)
  const range90 = getLastNDaysRangeKst(90)
  const rangeThisMonth = getThisMonthRange()
  const rangeLastMonth = getLastMonthRange()

  function isRangeActive(r: { from: string; to: string }) {
    return value.from === r.from && value.to === r.to
  }

  const quickSelects = [
    { label: '7일', range: range7 },
    { label: '30일', range: range30 },
    { label: '90일', range: range90 },
    { label: '이번달', range: rangeThisMonth },
    { label: '지난달', range: rangeLastMonth },
  ]

  const movementTypeOptions = [
    { type: 'INBOUND', label: '입고', color: 'bg-emerald-500' },
    { type: 'OUTBOUND', label: '출고', color: 'bg-red-500' },
    { type: 'RETURN', label: '반품', color: 'bg-blue-500' },
    { type: 'TRANSFER', label: '이동', color: 'bg-yellow-500' },
    { type: 'ADJUSTMENT', label: '조정', color: 'bg-purple-500' },
  ]

  function toggleMovementType(type: string) {
    const current = value.movementTypes ?? []
    const next = current.includes(type) ? current.filter((t) => t !== type) : [...current, type]
    onChange({ ...value, movementTypes: next.length > 0 ? next : undefined })
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">보관 위치</Label>
          <Select
            value={value.locationId ?? ALL}
            onValueChange={(v) => update('locationId', v === ALL ? undefined : v)}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>전체 위치</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">판매 채널</Label>
          <Select
            value={value.channelId ?? ALL}
            onValueChange={(v) => update('channelId', v === ALL ? undefined : v)}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>전체 채널</SelectItem>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">채널 그룹</Label>
          <Select
            value={value.channelGroupId ?? ALL}
            onValueChange={(v) => update('channelGroupId', v === ALL ? undefined : v)}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>전체 그룹</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">시작일</Label>
          <Input
            type="date"
            className="w-40"
            value={value.from ?? ''}
            onChange={(e) => update('from', e.target.value || undefined)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">종료일</Label>
          <Input
            type="date"
            className="w-40"
            value={value.to ?? ''}
            onChange={(e) => update('to', e.target.value || undefined)}
          />
        </div>

        <Button variant="outline" size="sm" onClick={reset}>
          초기화
        </Button>
      </div>

      {/* Quick-select date range buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">기간:</span>
        {quickSelects.map((qs) => (
          <Button
            key={qs.label}
            variant={isRangeActive(qs.range) ? 'default' : 'outline'}
            size="sm"
            onClick={() => onChange({ ...value, from: qs.range.from, to: qs.range.to })}
          >
            {qs.label}
          </Button>
        ))}
      </div>

      {/* Movement type toggle buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">이동유형:</span>
        {movementTypeOptions.map((mt) => (
          <Button
            key={mt.type}
            variant={value.movementTypes?.includes(mt.type) ? 'default' : 'outline'}
            size="sm"
            onClick={() => toggleMovementType(mt.type)}
          >
            <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${mt.color}`} />
            {mt.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
