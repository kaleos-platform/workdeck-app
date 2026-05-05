'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SELLER_HUB_LISTING_NEW_PATH } from '@/lib/deck-routes'

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
        const productRes = await fetch(`/api/sh/products/${productId}/listings`)
        if (!productRes.ok) throw new Error('판매 옵션 조회 실패')

        const productData: {
          groups: Array<{ channelId: string; channelName: string; listingCount: number }>
          mixed: Array<{ channelId: string; channelName: string }>
        } = await productRes.json()

        const channelMap = new Map<string, ChannelWithCount>()
        for (const g of productData.groups ?? []) {
          const cur = channelMap.get(g.channelId)
          channelMap.set(g.channelId, {
            id: g.channelId,
            name: g.channelName,
            listingCount: (cur?.listingCount ?? 0) + g.listingCount,
          })
        }
        for (const m of productData.mixed ?? []) {
          const cur = channelMap.get(m.channelId)
          channelMap.set(m.channelId, {
            id: m.channelId,
            name: m.channelName,
            listingCount: (cur?.listingCount ?? 0) + 1,
          })
        }

        const merged = Array.from(channelMap.values()).sort((a, b) =>
          a.name.localeCompare(b.name, 'ko-KR')
        )
        if (cancelled) return
        setChannels(merged)
        if (!selectedChannelId && merged.length > 0) {
          setSelectedChannelId(merged[0].id)
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

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  if (channels.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-10 text-center">
        <p className="text-sm text-muted-foreground">
          이 상품은 아직 판매채널 상품에 등록되지 않았습니다
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href={SELLER_HUB_LISTING_NEW_PATH}>
            <Plus className="mr-1 h-4 w-4" />
            판매채널 상품 등록
          </Link>
        </Button>
      </div>
    )
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
        </div>
      </Card>
      <div>
        <GroupsTable channelId={selectedChannelId} productId={productId} />
      </div>
    </div>
  )
}
