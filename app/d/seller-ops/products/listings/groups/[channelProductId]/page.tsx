import { GroupDetailView } from '@/components/sh/products/listings/group-detail-view'

type PageProps = {
  params: Promise<{ channelProductId: string }>
}

export default async function ChannelProductDetailPage({ params }: PageProps) {
  const { channelProductId } = await params
  return <GroupDetailView channelProductId={channelProductId} />
}
