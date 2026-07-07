import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { ChannelsClient } from '@/components/bo/channels/channels-client'

export default async function BlogOpsChannelsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">채널 관리</h1>
        <p className="text-sm text-muted-foreground">
          포스트를 발행할 채널과 채널별 포맷 프로필을 관리합니다.
        </p>
      </div>

      <ChannelsClient />
    </div>
  )
}
