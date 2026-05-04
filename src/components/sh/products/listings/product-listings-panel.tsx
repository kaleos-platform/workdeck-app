'use client'

import { useEffect, useMemo, useState } from 'react'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { GroupsTable } from './groups-table'

type ChannelWithCount = {
  id: string
  name: string
  listingCount: number
}

type Props = {
  productId: string
}

export function ProductListingsPanel({ productId }: Props) {
  const [channels, setChannels] = useState<ChannelWithCount[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [allRes, productRes] = await Promise.all([
          fetch('/api/channels?isActive=true&isSalesChannel=true'),
          fetch(`/api/sh/products/${productId}/listings`),
        ])
        if (!allRes.ok) throw new Error('채널 조회 실패')
        if (!productRes.ok) throw new Error('상품 listing 조회 실패')

        const channelData: { channels: Array<{ id: string; name: string }> } = await allRes.json()
        const productData: {
          groups: Array<{ channelId: string; listingCount: number }>
          mixed: Array<{ channelId: string }>
        } = await productRes.json()

        const countByChannel = new Map<string, number>()
        for (const g of productData.groups ?? []) {
          countByChannel.set(g.channelId, (countByChannel.get(g.channelId) ?? 0) + g.listingCount)
        }
        for (const m of productData.mixed ?? []) {
          countByChannel.set(m.channelId, (countByChannel.get(m.channelId) ?? 0) + 1)
        }

        const merged: ChannelWithCount[] = (channelData.channels ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          listingCount: countByChannel.get(c.id) ?? 0,
        }))
        if (cancelled) return
        setChannels(merged)
        if (!selectedChannelId) {
          // 첫 listing 보유 채널을 기본 선택, 없으면 첫 채널
          const firstWithListings = merged.find((c) => c.listingCount > 0)
          const initial = firstWithListings ?? merged[0]
          if (initial) setSelectedChannelId(initial.id)
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
  }, [productId])

  const totalListings = useMemo(
    () => channels.reduce((sum, c) => sum + c.listingCount, 0),
    [channels]
  )

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  if (channels.length === 0) {
    return <p className="text-sm text-muted-foreground">활성 판매채널이 없습니다.</p>
  }

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <Card className="p-3">
        <div className="md:hidden">
          <Select
            value={selectedChannelId ?? undefined}
            onValueChange={(v) => setSelectedChannelId(v)}
          >
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
        <div className="hidden md:block">
          <div className="mb-2 text-xs font-medium text-muted-foreground">채널</div>
          <ul className="space-y-1">
            {channels.map((c) => {
              const isSelected = c.id === selectedChannelId
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedChannelId(c.id)}
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
          {totalListings === 0 && (
            <p className="mt-3 px-3 text-xs text-muted-foreground">
              이 상품은 아직 판매채널 상품에 등록되지 않았습니다
            </p>
          )}
        </div>
      </Card>
      <div>
        <GroupsTable channelId={selectedChannelId} productId={productId} />
      </div>
    </div>
  )
}
