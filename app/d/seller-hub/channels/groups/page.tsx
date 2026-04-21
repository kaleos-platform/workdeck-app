import { ChannelGroupManager } from '@/components/sh/channels/channel-group-manager'

export default function ChannelGroupsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">채널 그룹</h1>
        <p className="text-sm text-muted-foreground">채널을 그룹으로 묶어 분류하고 관리합니다</p>
      </div>
      <ChannelGroupManager />
    </div>
  )
}
