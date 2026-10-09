import { prisma } from '@/lib/prisma'

/**
 * 쿠팡 옵션 ↔ 리스팅 연결. 리스팅 쪽 기존 확정(다른 쿠팡 옵션)은 어떤 경우에도 덮지 않는다.
 * 쿠팡 옵션 쪽 기존 연결·매칭 안 함은 explicit(사람이 직접 고름)일 때만 교체한다.
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
  if (item.listingId && !opts.explicit)
    return { ok: false, reason: '이미 다른 판매채널 상품에 연결된 쿠팡 옵션입니다', status: 400 }
  // 오래된 화면의 후보·일괄 확정이 매칭 안 함 항목을 되살리지 않게 — 명시적 선택만 푼다.
  if (item.excludedAt && !opts.explicit)
    return { ok: false, reason: '매칭 안 함으로 지정된 쿠팡 옵션입니다', status: 400 }

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
  // explicit 이면 기존 연결도 이 update 하나로 교체된다(해제→확정 사이 중간 실패 없음).
  try {
    await prisma.coupangProductItem.update({
      where: { id: coupangProductItemId },
      data: { listingId, excludedAt: null },
    })
  } catch (err) {
    // 동시 확정으로 같은 리스팅이 먼저 연결됐으면 listingId @unique 위반 — 충돌로 돌려준다.
    if ((err as { code?: string }).code === 'P2002')
      return {
        ok: false,
        reason: '방금 다른 쿠팡 옵션이 이 판매채널 상품에 연결됐습니다',
        status: 409,
      }
    throw err
  }
  return { ok: true }
}
