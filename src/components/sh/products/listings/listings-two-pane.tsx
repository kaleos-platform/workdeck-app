'use client'

import { useMemo, useState } from 'react'

import { Card } from '@/components/ui/card'

import { ChannelRail } from './channel-rail'
import { GroupsTable } from './groups-table'
import { ChannelMirrorView } from './channel-mirror-view'

type RailChannel = {
  id: string
  name: string
  externalSource: string | null
  listingCount: number
}

export function ListingsTwoPane() {
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [channels, setChannels] = useState<RailChannel[]>([])

  // 선택된 채널이 채널 자체 배송(연동) 채널이면 읽기전용 미러 뷰로 분기
  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) ?? null,
    [channels, selectedChannelId]
  )
  const isFulfillmentChannel = selectedChannel?.externalSource != null

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <Card className="p-3">
        <ChannelRail
          selectedChannelId={selectedChannelId}
          onSelectChannel={setSelectedChannelId}
          onChannelsLoaded={setChannels}
        />
      </Card>
      <div>
        {isFulfillmentChannel && selectedChannelId ? (
          <ChannelMirrorView channelId={selectedChannelId} />
        ) : (
          <GroupsTable channelId={selectedChannelId} />
        )}
      </div>
    </div>
  )
}
