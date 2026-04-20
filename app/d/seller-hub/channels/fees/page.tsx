import { ChannelFeesBulk } from '@/components/sh/channels/channel-fees-bulk'

export default function ChannelFeesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">수수료 설정</h1>
        <p className="text-sm text-muted-foreground">
          모든 채널의 카테고리별 수수료율을 한눈에 확인합니다
        </p>
      </div>
      <ChannelFeesBulk />
    </div>
  )
}
