'use client'

import { DelChannelManager } from '@/components/del/channel-manager'

export default function DeliveryChannelsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">판매 채널 관리</h1>
      <DelChannelManager />
    </div>
  )
}
