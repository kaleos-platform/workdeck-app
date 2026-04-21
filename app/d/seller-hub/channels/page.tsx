import { ShChannelManager } from '@/components/sh/channels/channel-manager'

export default function ChannelsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">채널 관리</h1>
        <p className="text-sm text-muted-foreground">
          판매 채널을 등록하고 어드민 URL, 배송비, 마케팅 설정을 관리합니다
        </p>
      </div>
      <ShChannelManager />
    </div>
  )
}
