// 쿠팡 광고 검색어 성과 로더 — 옵션ID(vendorItemId) → CoupangProductItem → sellerProductId →
// 같은 sellerProductId 의 리스팅들 → 대상(채널상품 또는 단독 리스팅) 귀속.
// AdRecord 는 workspace 스코프, 나머지는 space 스코프라 Workspace.spaceId 로 잇는다.
import { prisma } from '@/lib/prisma'
import { toKeywordList } from '@/lib/sh/keyword-change'
import {
  computeAdKeywordPerformance,
  type AdKeywordPerformance,
} from '@/lib/sh/ad-keyword-performance'

export type AdKeywordPerformanceResult = AdKeywordPerformance & {
  attributed: boolean
  window: { from: string; to: string } | null
}

const EMPTY: AdKeywordPerformanceResult = {
  attributed: false,
  window: null,
  keywordStats: {},
  discover: [],
  prune: [],
}

const DAY_MS = 86_400_000
const WINDOW_DAYS = 30
// date 컬럼은 KST 자정(= 전날 15:00 UTC)으로 저장된다. 표시용 날짜는 +9h 후 ISO 앞 10자.
const kstDate = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)

export async function loadAdKeywordPerformance(
  spaceId: string,
  target: { channelProductId?: string; listingId?: string }
): Promise<AdKeywordPerformanceResult | null> {
  // 1. 대상 해석 — 소속 리스팅이면 채널상품 단위로 올린다. 못 찾으면 null(404).
  let channelProductId = target.channelProductId ?? null
  if (!channelProductId && target.listingId) {
    const l = await prisma.productListing.findFirst({
      where: { id: target.listingId, spaceId },
      select: { id: true, channelProductId: true, searchName: true, keywords: true },
    })
    if (!l) return null
    if (!l.channelProductId) {
      return loadForListings(spaceId, [l.id], l.searchName, toKeywordList(l.keywords))
    }
    channelProductId = l.channelProductId
  }
  if (!channelProductId) return null
  const cp = await prisma.channelProduct.findFirst({
    where: { id: channelProductId, spaceId },
    select: { baseSearchName: true, keywords: true, listings: { select: { id: true } } },
  })
  if (!cp) return null
  return loadForListings(
    spaceId,
    cp.listings.map((l) => l.id),
    cp.baseSearchName,
    toKeywordList(cp.keywords)
  )
}

async function loadForListings(
  spaceId: string,
  listingIds: string[],
  name: string,
  keywords: string[]
): Promise<AdKeywordPerformanceResult> {
  const workspace = await prisma.workspace.findUnique({
    where: { spaceId },
    select: { id: true },
  })
  if (!workspace || listingIds.length === 0) return EMPTY

  const linked = await prisma.coupangProductItem.findMany({
    where: { spaceId, listingId: { in: listingIds } },
    select: { sellerProductId: true },
  })
  const sellerProductIds = [...new Set(linked.map((i) => i.sellerProductId))]
  if (sellerProductIds.length === 0) return EMPTY

  const items = await prisma.coupangProductItem.findMany({
    where: { spaceId, sellerProductId: { in: sellerProductIds } },
    select: { rgVendorItemId: true, mpVendorItemId: true },
  })
  const optionIds = items
    .flatMap((i) => [i.rgVendorItemId, i.mpVendorItemId])
    .filter(Boolean) as string[]
  if (optionIds.length === 0) return EMPTY

  // 구간 끝은 워크스페이스 최신 적재일 — 상품별 최신일을 쓰면 광고를 멈춘 상품의 옛 데이터가 「최근 30일」로 보인다.
  const latest = await prisma.adRecord.aggregate({
    where: { workspaceId: workspace.id, keyword: { not: null } },
    _max: { date: true },
  })
  const base = { workspaceId: workspace.id, optionId: { in: optionIds }, keyword: { not: null } }
  const to = latest._max.date
  if (!to) return EMPTY
  const from = new Date(to.getTime() - (WINDOW_DAYS - 1) * DAY_MS)

  const grouped = await prisma.adRecord.groupBy({
    by: ['keyword'],
    where: { ...base, date: { gte: from, lte: to } },
    _sum: { impressions: true, clicks: true, orders1d: true, adCost: true },
  })
  const terms = grouped.map((g) => ({
    term: g.keyword as string,
    imp: g._sum.impressions ?? 0,
    clk: g._sum.clicks ?? 0,
    ord: g._sum.orders1d ?? 0,
    cost: Number(g._sum.adCost ?? 0),
  }))

  return {
    attributed: true,
    window: { from: kstDate(from), to: kstDate(to) },
    ...computeAdKeywordPerformance({ terms, name, keywords }),
  }
}
