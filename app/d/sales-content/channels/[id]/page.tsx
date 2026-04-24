import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ChannelForm } from '@/components/sc/channels/channel-form'
import { SALES_CONTENT_CHANNELS_PATH } from '@/lib/deck-routes'

type Props = { params: Promise<{ id: string }> }

export default async function ChannelDetailPage({ params }: Props) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const { id } = await params
  const channel = await prisma.salesContentChannel.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!channel) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">{channel.name}</h1>
        <Button asChild variant="ghost">
          <Link href={SALES_CONTENT_CHANNELS_PATH}>← 목록</Link>
        </Button>
      </div>
      <ChannelForm
        mode="edit"
        channelId={channel.id}
        initial={{
          name: channel.name,
          platformSlug: channel.platformSlug,
          platform: channel.platform,
          kind: channel.kind,
          publisherMode: channel.publisherMode,
          collectorMode: channel.collectorMode,
          isActive: channel.isActive,
        }}
      />
    </div>
  )
}
