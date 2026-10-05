import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'
import { computeMatchCandidates, type MatchStatus } from './match-candidates'

export type MatchingRow = {
  id: string
  itemName: string | null
  sellerProductId: string
  rgVendorItemId: string | null
  mpVendorItemId: string | null
  rgSalePrice: number | null
  mpSalePrice: number | null
  collectedAt: string
  status: MatchStatus
  listing: { id: string; name: string } | null
  candidates: Array<{ id: string; name: string }>
}

const STATUS_ORDER: Record<MatchStatus, number> = {
  NEEDS_REVIEW: 0,
  CANDIDATE: 1,
  AMBIGUOUS: 2,
  NONE: 3,
  CONFIRMED: 4,
}

export async function loadMatchingRows(spaceId: string): Promise<MatchingRow[]> {
  const items = await prisma.coupangProductItem.findMany({
    where: { spaceId },
    select: {
      id: true,
      itemName: true,
      sellerProductId: true,
      rgVendorItemId: true,
      mpVendorItemId: true,
      rgSalePrice: true,
      mpSalePrice: true,
      collectedAt: true,
      listingId: true,
    },
  })
  if (items.length === 0) return []

  // 쿠팡 리스팅 채널 = 로켓그로스 채널의 대표 채널(판매자배송). 대표가 없으면 RG 채널 자신.
  const rgChannel = await prisma.channel.findFirst({
    where: { spaceId, externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH },
    select: { id: true, representativeChannelId: true },
  })
  const listingChannelId = rgChannel ? (rgChannel.representativeChannelId ?? rgChannel.id) : null
  const listings = listingChannelId
    ? await prisma.productListing.findMany({
        where: { spaceId, channelId: listingChannelId },
        select: { id: true, displayName: true, items: { select: { optionId: true, quantity: true } } },
      })
    : []

  // vendorItemId(=재고 optionId) → skuId : 최신 재고건전성 스냅샷에서.
  const ws = await resolveCoupangWorkspaceForSpace(spaceId)
  const skuByVendorItemId = new Map<string, string>()
  const compositionBySku = new Map<string, Array<{ optionId: string; quantity: number }>>()
  if (ws) {
    const latest = await prisma.inventoryRecord.findFirst({
      where: { workspaceId: ws.workspaceId, fileType: 'INVENTORY_HEALTH' },
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    if (latest) {
      const records = await prisma.inventoryRecord.findMany({
        where: { workspaceId: ws.workspaceId, fileType: 'INVENTORY_HEALTH', snapshotDate: latest.snapshotDate },
        select: { optionId: true, skuId: true },
      })
      for (const r of records) if (r.optionId && r.skuId) skuByVendorItemId.set(String(r.optionId), String(r.skuId))
    }
    const maps = await prisma.invLocationProductMap.findMany({
      where: { locationId: ws.locationId },
      select: { externalCode: true, items: { select: { optionId: true, quantity: true } } },
    })
    for (const m of maps) compositionBySku.set(m.externalCode, m.items)
  }

  const computed = computeMatchCandidates({
    items,
    skuByVendorItemId,
    compositionBySku,
    listings: listings.map((l) => ({ id: l.id, items: l.items })),
  })
  const nameById = new Map(listings.map((l) => [l.id, l.displayName]))
  // 확정 리스팅이 다른 채널(대표 채널 변경 등)이면 이름을 따로 가져온다.
  const missing = items.filter((i) => i.listingId && !nameById.has(i.listingId)).map((i) => i.listingId!)
  if (missing.length) {
    const extra = await prisma.productListing.findMany({
      where: { id: { in: missing }, spaceId },
      select: { id: true, displayName: true },
    })
    for (const l of extra) nameById.set(l.id, l.displayName)
  }

  return items
    .map((i) => {
      const c = computed.get(i.id)!
      return {
        id: i.id,
        itemName: i.itemName,
        sellerProductId: i.sellerProductId,
        rgVendorItemId: i.rgVendorItemId,
        mpVendorItemId: i.mpVendorItemId,
        rgSalePrice: i.rgSalePrice,
        mpSalePrice: i.mpSalePrice,
        collectedAt: i.collectedAt.toISOString(),
        status: c.status,
        listing: i.listingId ? { id: i.listingId, name: nameById.get(i.listingId) ?? i.listingId } : null,
        candidates: c.candidateListingIds.map((id) => ({ id, name: nameById.get(id) ?? id })),
      }
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.itemName ?? '').localeCompare(b.itemName ?? ''))
}
