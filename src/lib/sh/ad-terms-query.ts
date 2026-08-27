// 광고 실검색어 집계 — `app/api/sh/keywords/ad-terms/route.ts` 에 있던 본문을 순수 서버 함수로
// 뽑았다. AI 초안 라우트(name-draft)가 같은 데이터를 프롬프트 근거로 써야 하는데, 서버 라우트가
// 자기 자신의 HTTP 엔드포인트를 fetch 할 수는 없기 때문이다(쿠키 전달·서버리스 self-call).
//
// ⚠️ 스코프가 둘이다. AdRecord 는 **workspace** 스코프고 키워드 마스터는 **space** 스코프다.
// 둘 사이에 FK 가 없으므로 다음 경로만 탄다:
//
//   space → resolveCoupangWorkspaceForSpace → workspaceId
//   space + productId → AdCampaignProductMap → campaignId[]
//   workspaceId + campaignId[] → AdRecord.keyword 집계
//
// 매핑 행이 없으면 **조용히 빈 결과**다. 매핑 없이 캠페인을 상품에 귀속시키는 추정은
// AdCampaignProductMap 주석의 명시적 금지 사항이고, coupang-ads 를 쓰지 않는 space 에서
// 호출해도 에러 없이 빈 결과여야 한다. 절대 에러로 승격하지 말 것.
import { prisma } from '@/lib/prisma'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'
import { normalizeKeyword } from '@/lib/sh/keyword-normalize'

export type AdTermRow = {
  keyword: string
  impressions: number
  clicks: number
  adCost: number
  orders: number
  revenue: number
  roas: number | null
  existingKeywordId: string | null
}

export type AdTermsResult = {
  data: AdTermRow[]
  linked: boolean
  campaignCount?: number
}

const EMPTY: AdTermsResult = { data: [], linked: false }

/** 상품에 귀속된 캠페인들의 광고 검색어를 클릭 많은 순으로 집계한다. 연동/매핑이 없으면 빈 결과. */
export async function loadAdTermsForProduct(
  spaceId: string,
  productId: string,
  limit = 50
): Promise<AdTermsResult> {
  // 1. 쿠팡 워크스페이스 해석 — 연동 미설정이면 여기서 끝.
  const coupang = await resolveCoupangWorkspaceForSpace(spaceId)
  if (!coupang) return EMPTY

  // 2. 상품 → 캠페인 역인덱스. 매핑이 없으면 귀속시킬 광고가 없다는 뜻이다.
  const maps = await prisma.adCampaignProductMap.findMany({
    where: { spaceId, productId },
    select: { campaignId: true },
  })
  const campaignIds = Array.from(new Set(maps.map((m) => m.campaignId)))
  if (campaignIds.length === 0) return EMPTY

  // 3. 해당 캠페인들의 검색어 집계.
  const grouped = await prisma.adRecord.groupBy({
    by: ['keyword'],
    where: {
      workspaceId: coupang.workspaceId,
      campaignId: { in: campaignIds },
      keyword: { not: null },
    },
    _sum: {
      impressions: true,
      clicks: true,
      adCost: true,
      orders1d: true,
      revenue1d: true,
    },
  })

  // 이미 마스터에 있는 검색어는 표시해준다(중복 등록 방지).
  const known = await prisma.keywordMaster.findMany({
    where: { spaceId },
    select: { id: true, normalized: true },
  })
  const knownByNormalized = new Map(known.map((k) => [k.normalized, k.id]))

  const data = grouped
    .map((g) => {
      const keyword = (g.keyword ?? '').trim()
      const clicks = g._sum.clicks ?? 0
      const adCost = Number(g._sum.adCost ?? 0)
      const revenue = Number(g._sum.revenue1d ?? 0)
      return {
        keyword,
        impressions: g._sum.impressions ?? 0,
        clicks,
        adCost,
        orders: g._sum.orders1d ?? 0,
        revenue,
        roas: adCost > 0 ? revenue / adCost : null,
        existingKeywordId: knownByNormalized.get(normalizeKeyword(keyword)) ?? null,
      }
    })
    .filter((r) => r.keyword.length > 0)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, limit)

  return { data, linked: true, campaignCount: campaignIds.length }
}
