import { prisma } from '@/lib/prisma'

/**
 * 쿠팡 옵션 ↔ 리스팅 연결. 양방향 모두 기존 확정을 조용히 덮지 않는다 —
 * 재연결하려면 먼저 해제해야 한다(listingId 는 @unique 라 덮으면 기존 연결이 끊긴다).
 */
export async function linkCoupangItem(
  spaceId: string,
  coupangProductItemId: string,
  listingId: string
): Promise<{ ok: true } | { ok: false; reason: string; status: number }> {
  const listing = await prisma.productListing.findFirst({ where: { id: listingId, spaceId }, select: { id: true } })
  if (!listing) return { ok: false, reason: '판매채널 상품을 찾을 수 없습니다', status: 404 }

  const item = await prisma.coupangProductItem.findFirst({
    where: { id: coupangProductItemId, spaceId },
    select: { id: true, listingId: true },
  })
  if (!item) return { ok: false, reason: '쿠팡 옵션을 찾을 수 없습니다', status: 404 }
  if (item.listingId === listingId) return { ok: true }
  if (item.listingId) return { ok: false, reason: '이미 다른 판매채널 상품에 연결된 쿠팡 옵션입니다', status: 400 }

  const conflicting = await prisma.coupangProductItem.findFirst({
    where: { listingId, spaceId, NOT: { id: coupangProductItemId } },
    select: { id: true },
  })
  if (conflicting) return { ok: false, reason: '이미 다른 쿠팡 옵션이 연결된 판매채널 상품입니다', status: 400 }

  await prisma.coupangProductItem.update({ where: { id: coupangProductItemId }, data: { listingId } })
  return { ok: true }
}
