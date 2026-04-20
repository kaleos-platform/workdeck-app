import { ChannelDetailView } from '@/components/sh/channels/channel-detail'

export default async function ChannelDetailPage({
  params,
}: {
  params: Promise<{ channelId: string }>
}) {
  const { channelId } = await params

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">채널 상세</h1>
        <p className="text-sm text-muted-foreground">
          채널 정보와 카테고리별 수수료율을 관리합니다
        </p>
      </div>
      <ChannelDetailView channelId={channelId} />
    </div>
  )
}
