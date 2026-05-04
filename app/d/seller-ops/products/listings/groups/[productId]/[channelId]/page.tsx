import { GroupDetailView } from '@/components/sh/products/listings/group-detail-view'

type PageProps = {
  params: Promise<{ productId: string; channelId: string }>
  searchParams: Promise<{ g?: string }>
}

export default async function ListingGroupDetailPage({ params, searchParams }: PageProps) {
  const { productId, channelId } = await params
  const { g } = await searchParams
  return <GroupDetailView productId={productId} channelId={channelId} groupKey={g ?? null} />
}
