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

export type DashboardFilterValues = {
  locationId?: string
  channelId?: string
  channelGroupId?: string
  from?: string
  to?: string
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

  function update<K extends keyof DashboardFilterValues>(
    key: K,
    next: DashboardFilterValues[K]
  ) {
    onChange({ ...value, [key]: next })
  }

  function reset() {
    onChange({})
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
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
  )
}
