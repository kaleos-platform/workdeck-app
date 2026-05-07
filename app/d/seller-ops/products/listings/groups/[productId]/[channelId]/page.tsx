import { redirect } from 'next/navigation'
import { getSellerHubChannelProductPath, SELLER_HUB_LISTINGS_PATH } from '@/lib/deck-routes'
import { prisma } from '@/lib/prisma'
import { resolveSpaceContext } from '@/lib/api-helpers'

type PageProps = {
  params: Promise<{ productId: string; channelId: string }>
  searchParams: Promise<{ g?: string }>
}

export default async function ListingGroupDetailPage({ params }: PageProps) {
  const { productId, channelId } = await params
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) redirect(SELLER_HUB_LISTINGS_PATH)

  // 기존 URL로 진입하면 해당 ChannelProduct를 찾아 새 URL로 리다이렉트
  const cp = await prisma.channelProduct.findFirst({
    where: { productId, channelId, spaceId: resolved.space.id },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!cp) redirect(SELLER_HUB_LISTINGS_PATH)
  redirect(getSellerHubChannelProductPath(cp.id))
}
