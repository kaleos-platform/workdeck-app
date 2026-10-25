// 키워드 목록을 서버에서 직접 쓰는 공통 경로(에이전트 승인 액션용).
// CP/리스팅 PATCH 라우트와 같은 규칙 — 저장과 KeywordChangeLog 를 한 트랜잭션, 커밋 뒤 흡수.
// 라우트는 이름·순위추적·전파가 얽혀 있어 호출하지 않는다(상품명은 건드리지 않는다).
import { prisma } from '@/lib/prisma'
import { diffKeywordChange, toKeywordList } from '@/lib/sh/keyword-change'
import { absorbKeywords } from '@/lib/sh/keyword-absorb'

export type KeywordTarget = { channelProductId?: string; listingId?: string }

export async function readTargetKeywords(spaceId: string, target: KeywordTarget) {
  if (target.channelProductId) {
    const cp = await prisma.channelProduct.findFirst({
      where: { id: target.channelProductId, spaceId },
      select: {
        baseSearchName: true,
        keywords: true,
        listings: {
          select: {
            items: {
              where: { option: { deletedAt: null } },
              select: { option: { select: { productId: true } } },
            },
          },
        },
      },
    })
    if (!cp) return null
    const ids = new Set(cp.listings.flatMap((l) => l.items.map((i) => i.option.productId)))
    return {
      name: cp.baseSearchName,
      keywords: toKeywordList(cp.keywords),
      productId: ids.size === 1 ? [...ids][0] : null,
    }
  }
  if (target.listingId) {
    const l = await prisma.productListing.findFirst({
      where: { id: target.listingId, spaceId },
      select: {
        searchName: true,
        keywords: true,
        channelProductId: true,
        items: {
          where: { option: { deletedAt: null } },
          select: { option: { select: { productId: true } } },
        },
      },
    })
    if (!l) return null
    const ids = new Set(l.items.map((i) => i.option.productId))
    return {
      name: l.searchName,
      keywords: toKeywordList(l.keywords),
      productId: ids.size === 1 ? [...ids][0] : null,
      channelProductId: l.channelProductId,
    }
  }
  return null
}

export async function applyKeywordsToTarget(input: {
  spaceId: string
  target: KeywordTarget
  before: string[]
  after: string[]
  name: string
  productId: string | null
  channelProductId?: string | null
  actorUserId: string | null
}) {
  const { spaceId, target, before, after, name, productId } = input
  const diff = diffKeywordChange({
    beforeName: name,
    afterName: name,
    beforeKeywords: before,
    afterKeywords: after,
  })
  await prisma.$transaction(async (tx) => {
    if (target.channelProductId) {
      await tx.channelProduct.update({
        where: { id: target.channelProductId },
        data: { keywords: after },
      })
    } else {
      await tx.productListing.update({
        where: { id: target.listingId! },
        data: { keywords: after },
      })
    }
    if (diff.changed) {
      await tx.keywordChangeLog.create({
        data: {
          spaceId,
          listingId: target.listingId ?? null,
          channelProductId: target.channelProductId ?? input.channelProductId ?? null,
          productId,
          beforeName: name,
          afterName: name,
          beforeKeywords: toKeywordList(before),
          afterKeywords: toKeywordList(after),
          multiChange: diff.multiChange,
          actorUserId: input.actorUserId,
        },
      })
    }
  })
  await absorbKeywords({
    spaceId,
    keywords: after,
    productId,
    listingId: target.channelProductId ? null : (target.listingId ?? null),
  })
}
