import { ShChannelManager } from '@/components/sh/channels/channel-manager'

export default function ChannelsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">채널 관리</h1>
        <p className="text-sm text-muted-foreground">
          판매 채널과 그룹, 수수료를 한 화면에서 관리합니다
        </p>
      </div>
      <ShChannelManager />
    </div>
  )
}
