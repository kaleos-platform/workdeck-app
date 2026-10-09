import { prisma } from '@/lib/prisma'

/**
 * 쿠팡 옵션 ↔ 리스팅 연결. 양방향 모두 기존 확정을 조용히 덮지 않는다 —
 * 재연결하려면 먼저 해제해야 한다(listingId 는 @unique 라 덮으면 기존 연결이 끊긴다).
 */
export async function linkCoupangItem(
  spaceId: string,
  coupangProductItemId: string,
  listingId: string,
  /**
   * explicit = 사람이 "다른 상품 선택"으로 직접 고른 경우. 기존 연결을 한 번의 update 로
   * 갈아끼우고(해제→확정 두 번 호출하다 중간 실패로 연결이 사라지지 않게), 매칭 안 함도 푼다.
   * 기본(후보 확정·일괄 확정)은 기존 연결·매칭 안 함 항목을 건드리지 않는다.
   */
  opts: { explicit?: boolean } = {}
): Promise<{ ok: true } | { ok: false; reason: string; status: number }> {
  const listing = await prisma.productListing.findFirst({
    where: { id: listingId, spaceId },
    select: { id: true },
  })
  if (!listing) return { ok: false, reason: '판매채널 상품을 찾을 수 없습니다', status: 404 }

  const item = await prisma.coupangProductItem.findFirst({
    where: { id: coupangProductItemId, spaceId },
    select: { id: true, listingId: true, excludedAt: true },
  })
  if (!item) return { ok: false, reason: '쿠팡 옵션을 찾을 수 없습니다', status: 404 }
  if (item.listingId === listingId) return { ok: true }
  if (item.listingId)
    return { ok: false, reason: '이미 다른 판매채널 상품에 연결된 쿠팡 옵션입니다', status: 400 }

  const conflicting = await prisma.coupangProductItem.findFirst({
    where: { listingId, spaceId, NOT: { id: coupangProductItemId } },
    select: { id: true },
  })
  if (conflicting)
    return {
      ok: false,
      reason:
        '이미 다른 쿠팡 옵션이 연결된 판매채널 상품입니다 — 쿠팡 상품 매칭 화면에서 그 연결을 해제하거나 매칭 안 함으로 바꾼 뒤 다시 시도하세요',
      status: 400,
    }

  // 연결은 곧 "매칭함" 결정이다 — 매칭 안 함 표시가 있었다면 함께 푼다.
  await prisma.coupangProductItem.update({
    where: { id: coupangProductItemId },
    data: { listingId, excludedAt: null },
  })
  return { ok: true }
}
