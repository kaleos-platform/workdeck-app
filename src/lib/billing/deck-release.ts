import 'server-only'

import { revalidateTag, unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { DECK_CATALOG_DEFAULTS } from './catalog-defaults'

/**
 * 업무 공개(released) 판정 단일 출처 — 앱·서버 API·마케팅이 모두 이 모듈을 쓴다.
 *
 * - 공개(released=true): 누구나 추가·구독 가능, 마케팅에 가격·구독 CTA 노출.
 * - 준비중(released=false 또는 과금 상품 행 없음): 신규 추가·구독 차단, 마케팅은 출시 알림만.
 * - 이미 설치된 공간(DeckInstance 행 존재, 비활성 포함) 또는 구독 이력(종료 포함)이 있는
 *   공간은 공개 여부와 무관하게 계속 쓴다. 사용·쓰기·MCP·정기결제(entitlement)는 이 플래그를
 *   보지 않는다 — 신규 진입 경로만 막는다.
 */

/** 마케팅 정적 생성 캐시 태그 — 어드민에서 공개 상태를 바꾸면 무효화한다 */
export const DECK_RELEASE_TAG = 'deck-release'

/** DB 조회 실패(빌드 환경 등) 시 쓰는 공개 목록 — 시드 기본값과 같다 */
export const RELEASE_FALLBACK_DECK_IDS = DECK_CATALOG_DEFAULTS.filter((d) => d.released).map(
  (d) => d.id
)

export function isDeckReleased(product: { released: boolean } | null | undefined): boolean {
  return product?.released === true
}

/** 이 공간에서 새로 추가·구독할 수 없는 업무 id (준비중이면서 설치·구독 이력 없음) */
export async function findClosedDecks(spaceId: string, deckIds: string[]): Promise<string[]> {
  if (deckIds.length === 0) return []
  const [products, instances, items] = await Promise.all([
    prisma.billingDeckProduct.findMany({
      where: { id: { in: deckIds } },
      select: { id: true, released: true },
    }),
    prisma.deckInstance.findMany({
      where: { spaceId, deckAppId: { in: deckIds } },
      select: { deckAppId: true },
    }),
    prisma.subscriptionItem.findMany({
      // 종료된 구독 이력(보장가 lockedPrice 보존)도 기존 고객으로 본다
      where: { subscription: { spaceId }, deckAppId: { in: deckIds } },
      select: { deckAppId: true },
    }),
  ])
  const open = new Set([
    ...products.filter(isDeckReleased).map((p) => p.id),
    ...instances.map((i) => i.deckAppId),
    ...items.flatMap((i) => (i.deckAppId ? [i.deckAppId] : [])),
  ])
  return deckIds.filter((id) => !open.has(id))
}

const loadReleasedDeckIds = unstable_cache(
  async () => {
    const rows = await prisma.billingDeckProduct.findMany({
      where: { isActive: true },
      select: { id: true, released: true },
    })
    return rows.filter(isDeckReleased).map((r) => r.id)
  },
  ['deck-release'],
  { tags: [DECK_RELEASE_TAG] }
)

/** 마케팅용 공개 업무 id 목록 (캐시). 조회 실패 시 시드 기본값으로 폴백한다. */
export async function getReleasedDeckIds(): Promise<string[]> {
  try {
    return await loadReleasedDeckIds()
  } catch (e) {
    console.error('[deck-release] 공개 업무 조회 실패 — 기본값 사용', e)
    return RELEASE_FALLBACK_DECK_IDS
  }
}

export function invalidateDeckReleaseCache(): void {
  revalidateTag(DECK_RELEASE_TAG, { expire: 0 })
}
