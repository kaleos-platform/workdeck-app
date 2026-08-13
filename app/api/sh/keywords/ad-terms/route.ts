import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'
import { normalizeKeyword } from '@/lib/sh/keyword-normalize'

/**
 * 광고 검색어 후보 — `?productId=`.
 *
 * ⚠️ 스코프가 둘이다. AdRecord 는 **workspace** 스코프고 키워드 마스터는 **space**
 * 스코프다. 둘 사이에 FK 가 없으므로 다음 경로만 탄다:
 *
 *   space → resolveCoupangWorkspaceForSpace → workspaceId
 *   space + productId → AdCampaignProductMap → campaignId[]
 *   workspaceId + campaignId[] → AdRecord.keyword 집계
 *
 * 매핑 행이 없으면 **조용히 빈 배열**을 돌려준다. 매핑 없이 캠페인을 상품에 귀속시키는
 * 추정은 AdCampaignProductMap 주석의 명시적 금지 사항이고, coupang-ads 를 쓰지 않는
 * space 에서 호출해도 에러 없이 빈 결과여야 한다.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const productId = req.nextUrl.searchParams.get('productId')?.trim() || null
  if (!productId) return errorResponse('productId 가 필요합니다', 400)

  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 50)))

  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  const empty = NextResponse.json({ data: [], linked: false })

  // 1. 쿠팡 워크스페이스 해석 — 연동 미설정이면 여기서 끝.
  const coupang = await resolveCoupangWorkspaceForSpace(resolved.space.id)
  if (!coupang) return empty

  // 2. 상품 → 캠페인 역인덱스. 매핑이 없으면 귀속시킬 광고가 없다는 뜻이다.
  const maps = await prisma.adCampaignProductMap.findMany({
    where: { spaceId: resolved.space.id, productId },
    select: { campaignId: true },
  })
  const campaignIds = Array.from(new Set(maps.map((m) => m.campaignId)))
  if (campaignIds.length === 0) return empty

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
    where: { spaceId: resolved.space.id },
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

  return NextResponse.json({ data, linked: true, campaignCount: campaignIds.length })
}
