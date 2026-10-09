'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Link2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { SELLER_HUB_COUPANG_MATCHING_PATH } from '@/lib/deck-routes'

import { ChannelRail } from './channel-rail'
import { GroupsTable } from './groups-table'
import { ChannelMirrorView } from './channel-mirror-view'

type RailChannel = {
  id: string
  name: string
  externalSource: string | null
  representativeChannelId?: string | null
  listingCount: number
}

export function ListingsTwoPane({ initialChannelId = null }: { initialChannelId?: string | null }) {
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(initialChannelId)
  const [channels, setChannels] = useState<RailChannel[]>([])

  // 선택된 채널이 채널 자체 배송(연동) 채널이면 읽기전용 미러 뷰로 분기
  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) ?? null,
    [channels, selectedChannelId]
  )
  const isFulfillmentChannel = selectedChannel?.externalSource != null
  // 쿠팡 Open API 연동 채널 = 로켓그로스 채널 자신 또는 로켓그로스가 대표로 지정한 채널(판매자배송).
  // 상품 매칭은 이 채널을 골랐을 때만 의미가 있어 채널 맥락에서만 진입점을 보인다.
  const isCoupangChannel =
    selectedChannel != null &&
    (selectedChannel.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH ||
      channels.some(
        (c) =>
          c.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH &&
          c.representativeChannelId === selectedChannel.id
      ))

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <Card className="p-3">
        <ChannelRail
          selectedChannelId={selectedChannelId}
          onSelectChannel={setSelectedChannelId}
          onChannelsLoaded={setChannels}
        />
      </Card>
      <div className="space-y-3">
        {isCoupangChannel && selectedChannelId && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">쿠팡 Open API 연동</span>
              <span className="ml-2 text-muted-foreground">
                쿠팡 옵션과 이 채널 상품을 연결하면 가격시뮬에서 쿠팡 판매가로 바로 반영할 수
                있습니다
              </span>
            </span>
            <Button asChild size="sm" variant="outline">
              <Link href={`${SELLER_HUB_COUPANG_MATCHING_PATH}?channel=${selectedChannelId}`}>
                상품 매칭
              </Link>
            </Button>
          </div>
        )}
        {isFulfillmentChannel && selectedChannelId ? (
          <ChannelMirrorView channelId={selectedChannelId} />
        ) : (
          <GroupsTable channelId={selectedChannelId} />
        )}
      </div>
    </div>
  )
}
