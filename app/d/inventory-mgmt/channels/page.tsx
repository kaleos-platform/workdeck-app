'use client'

import { ChannelManager } from '@/components/inv/channel-manager'

export default function ChannelsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">판매 채널 관리</h1>
        <p className="text-sm text-muted-foreground">
          출고 이동에 사용할 판매 채널과 그룹을 관리합니다.
        </p>
      </div>
      <ChannelManager />
    </div>
  )
}
