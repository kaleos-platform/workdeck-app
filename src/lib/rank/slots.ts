// 순위 추적 슬롯 = 추적이 켜진 대상들의 등록 키워드 수 합계. Space 단위 한도가 있다.

import { prisma } from '@/lib/prisma'
import { toKeywordList } from '@/lib/sh/keyword-change'

export const RANK_SLOT_LIMIT_DEFAULT = 300

export function getRankSlotLimit(): number {
  const n = Number(process.env.RANK_TRACKING_SLOT_LIMIT)
  return Number.isInteger(n) && n > 0 ? n : RANK_SLOT_LIMIT_DEFAULT
}

/** Space 의 사용 중인 슬롯 수. excludeTargetKey 대상은 제외한다(토글 직전 재계산용). */
export async function countRankSlots(spaceId: string, excludeTargetKey?: string): Promise<number> {
  const [cps, listings] = await Promise.all([
    prisma.channelProduct.findMany({
      where: { spaceId, rankTracking: true },
      select: { id: true, keywords: true },
    }),
    prisma.productListing.findMany({
      where: { spaceId, rankTracking: true, channelProductId: null },
      select: { id: true, keywords: true },
    }),
  ])
  return (
    cps
      .filter((t) => `cp:${t.id}` !== excludeTargetKey)
      .reduce((s, t) => s + toKeywordList(t.keywords).length, 0) +
    listings
      .filter((t) => `ls:${t.id}` !== excludeTargetKey)
      .reduce((s, t) => s + toKeywordList(t.keywords).length, 0)
  )
}
