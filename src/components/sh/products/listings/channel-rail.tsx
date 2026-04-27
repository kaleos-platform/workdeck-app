'use client'

import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type ChannelWithCount = {
  id: string
  name: string
  kind: string
  listingCount: number
}

type Props = {
  selectedChannelId: string | null
  onSelectChannel: (id: string) => void
  onChannelsLoaded?: (channels: ChannelWithCount[]) => void
  refreshKey?: number
}

export function ChannelRail({
  selectedChannelId,
  onSelectChannel,
  onChannelsLoaded,
  refreshKey = 0,
}: Props) {
  const [channels, setChannels] = useState<ChannelWithCount[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/channels?isActive=true')
        if (!res.ok) throw new Error('채널 조회 실패')
        const data: { channels: Array<{ id: string; name: string; kind: string }> } =
          await res.json()
        const channelsList = data.channels ?? []
        // 채널별 listing count 병렬 조회
        const counts = await Promise.all(
          channelsList.map(async (c) => {
            try {
              const r = await fetch(`/api/sh/products/listings?channelId=${c.id}&pageSize=1`)
              if (!r.ok) return 0
              const d: { total?: number } = await r.json()
              return d.total ?? 0
            } catch {
              return 0
            }
          })
        )
        const merged: ChannelWithCount[] = channelsList.map((c, idx) => ({
          ...c,
          listingCount: counts[idx] ?? 0,
        }))
        if (cancelled) return
        setChannels(merged)
        onChannelsLoaded?.(merged)
        // 초기 선택: 현재 미선택이면 첫 채널 자동
        if (!selectedChannelId && merged.length > 0) {
          onSelectChannel(merged[0].id)
        }
      } catch {
        if (!cancelled) setChannels([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // 모바일용 Select
  const mobileSelect = (
    <div className="md:hidden">
      <Select value={selectedChannelId ?? undefined} onValueChange={(v) => onSelectChannel(v)}>
        <SelectTrigger>
          <SelectValue placeholder="채널을 선택하세요" />
        </SelectTrigger>
        <SelectContent>
          {channels.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name} ({c.listingCount})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div>
      {mobileSelect}
      <div className="hidden md:block">
        <div className="mb-2 text-xs font-medium text-muted-foreground">채널</div>
        {loading ? (
          <p className="px-2 text-sm text-muted-foreground">불러오는 중...</p>
        ) : channels.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">활성 채널이 없습니다</p>
        ) : (
          <ul className="space-y-1">
            {channels.map((c) => {
              const isSelected = c.id === selectedChannelId
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelectChannel(c.id)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition ${
                      isSelected ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted/60'
                    }`}
                    aria-current={isSelected ? 'true' : undefined}
                  >
                    <span className="truncate">{c.name}</span>
                    <Badge variant={isSelected ? 'default' : 'secondary'} className="ml-2 shrink-0">
                      {c.listingCount}
                    </Badge>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
