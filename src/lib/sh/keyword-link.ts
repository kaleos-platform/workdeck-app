// KeywordMasterLink 생성·조회 공용 로직.
//
// ⚠️ upsert 를 쓰지 않는다. Postgres 는 NULL 을 서로 다른 값으로 취급하므로
// @@unique([keywordId, productId, listingId]) 는 productId 나 listingId 가 null 인 조합의
// 중복을 **막지 못한다**. 그래서 findFirst 로 직접 확인한 뒤 create 한다.
//
// 그리고 그 findFirst 는 반드시 명시적 null 을 넘겨야 한다 — Prisma 에서 undefined 는
// "필터 없음"이라 엉뚱한 행을 찾아온다(그러면 upsert 를 피한 의미가 사라진다).

import { prisma } from '@/lib/prisma'
import type { KeywordLinkRole } from '@/generated/prisma/client'

export type LinkTarget = {
  keywordId: string
  productId?: string | null
  listingId?: string | null
}

export const linkSelect = {
  id: true,
  keywordId: true,
  productId: true,
  listingId: true,
  role: true,
  sortOrder: true,
} as const

/** 대상 지정 정규화 — 빈 문자열/undefined 를 전부 null 로 접는다. */
export function normalizeLinkTarget(target: LinkTarget) {
  return {
    keywordId: target.keywordId,
    productId: target.productId || null,
    listingId: target.listingId || null,
  }
}

/**
 * 같은 (keyword, product, listing) 조합의 기존 링크. 없으면 null.
 * where 의 null 은 의도된 명시값이다(위 주석 참고).
 */
export async function findExistingLink(target: LinkTarget) {
  const t = normalizeLinkTarget(target)
  return prisma.keywordMasterLink.findFirst({
    where: { keywordId: t.keywordId, productId: t.productId, listingId: t.listingId },
    select: linkSelect,
  })
}

export type LinkOwnershipError = { message: string; status: number }

/**
 * 연결 3주체가 모두 이 space 것인지 확인한다.
 * KeywordMasterLink 자체에는 spaceId 가 없어서, 검증을 빠뜨리면 다른 space 의 상품을
 * 내 키워드에 붙일 수 있다(쓰기 방향의 space 격리).
 */
export async function assertLinkOwnership(
  spaceId: string,
  target: LinkTarget
): Promise<LinkOwnershipError | null> {
  const t = normalizeLinkTarget(target)

  const keyword = await prisma.keywordMaster.findFirst({
    where: { id: t.keywordId, spaceId },
    select: { id: true },
  })
  if (!keyword) return { message: '키워드를 찾을 수 없습니다', status: 404 }

  if (t.productId) {
    const product = await prisma.invProduct.findFirst({
      where: { id: t.productId, spaceId },
      select: { id: true },
    })
    if (!product) return { message: '상품을 찾을 수 없습니다', status: 404 }
  }

  if (t.listingId) {
    const listing = await prisma.productListing.findFirst({
      where: { id: t.listingId, spaceId },
      select: { id: true },
    })
    if (!listing) return { message: '판매채널 상품을 찾을 수 없습니다', status: 404 }
  }

  return null
}

/**
 * 링크를 만들거나(없을 때) 기존 링크의 role·sortOrder 를 갱신한다.
 * 호출 전에 assertLinkOwnership 을 통과시켜야 한다.
 */
export async function createOrUpdateLink(
  target: LinkTarget,
  patch: { role?: KeywordLinkRole; sortOrder?: number } = {}
) {
  const t = normalizeLinkTarget(target)
  const existing = await findExistingLink(t)

  if (existing) {
    if (patch.role === undefined && patch.sortOrder === undefined) {
      return { link: existing, created: false }
    }
    const updated = await prisma.keywordMasterLink.update({
      where: { id: existing.id },
      data: { role: patch.role, sortOrder: patch.sortOrder },
      select: linkSelect,
    })
    return { link: updated, created: false }
  }

  const link = await prisma.keywordMasterLink.create({
    data: {
      keywordId: t.keywordId,
      productId: t.productId,
      listingId: t.listingId,
      role: patch.role,
      sortOrder: patch.sortOrder,
    },
    select: linkSelect,
  })
  return { link, created: true }
}
