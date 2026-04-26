import { GroupDetailView } from '@/components/sh/products/listings/group-detail-view'

type PageProps = { params: Promise<{ productId: string; channelId: string }> }

export default async function ListingGroupDetailPage({ params }: PageProps) {
  const { productId, channelId } = await params
  return <GroupDetailView productId={productId} channelId={channelId} />
}
