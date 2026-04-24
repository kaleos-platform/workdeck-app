'use client'

import { useState } from 'react'

import { Card } from '@/components/ui/card'

import { ChannelRail } from './channel-rail'
import { GroupsTable } from './groups-table'

export function ListingsTwoPane() {
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <Card className="p-3">
        <ChannelRail selectedChannelId={selectedChannelId} onSelectChannel={setSelectedChannelId} />
      </Card>
      <div>
        <GroupsTable channelId={selectedChannelId} />
      </div>
    </div>
  )
}
