import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'
import { productDisplayName } from '@/lib/sh/product-display'
import { computeMatchCandidates, type MatchStatus } from './match-candidates'

/** 확정 전에 사람이 대조할 수 있도록 리스팅 쪽 정보를 함께 싣는다. */
export type MatchingListing = {
  id: string
  name: string
  /** 워크덱 판매가 */
  retailPrice: number | null
  /** 구성 — 옵션(상품이 여러 개면 상품명 포함) × 수량 */
  composition: Array<{ label: string; quantity: number }>
}

export type MatchingRow = {
  id: string
  /** 쿠팡 상품명 — 재고건전성 스냅샷 기준(RG 축만). 없으면 null */
  productName: string | null
  itemName: string | null
  sellerProductId: string
  rgVendorItemId: string | null
  mpVendorItemId: string | null
  rgSalePrice: number | null
  mpSalePrice: number | null
  collectedAt: string
  status: MatchStatus
  /** 같은 판매채널 상품을 노리는(또는 이미 연결된) 다른 쿠팡 옵션 — 중복 리스팅 판단용 */
  conflicts: Array<{ id: string; label: string }>
  /** 상품명에 '판매중지' — 매칭 안 함 추천 */
  stopSuggested: boolean
  /** 자동 후보의 근거 — 이 쿠팡 옵션의 SKU 가 재고 매핑에 있으면 그 SKU */
  basisSku: string | null
  listing: MatchingListing | null
  candidates: MatchingListing[]
}

export const LISTING_SELECT = {
  id: true,
  displayName: true,
  retailPrice: true,
  items: {
    select: {
      optionId: true,
      quantity: true,
      option: { select: { name: true, product: { select: { name: true, internalName: true } } } },
    },
  },
} as const

export type LoadedListing = {
  id: string
  displayName: string
  retailPrice: unknown
  items: Array<{
    optionId: string
    quantity: number
    option: { name: string; product: { name: string; internalName: string | null } }
  }>
}

export function summarize(l: LoadedListing): MatchingListing {
  // 세트가 여러 상품으로 구성되면 옵션명만으로는 구분이 안 된다 — 그때만 상품명을 붙인다.
  const multiProduct = new Set(l.items.map((it) => productDisplayName(it.option.product))).size > 1
  return {
    id: l.id,
    name: l.displayName,
    retailPrice: l.retailPrice == null ? null : Number(l.retailPrice),
    composition: l.items.map((it) => ({
      label: multiProduct
        ? `${productDisplayName(it.option.product)} ${it.option.name}`
        : it.option.name,
      quantity: it.quantity,
    })),
  }
}

const STATUS_ORDER: Record<MatchStatus, number> = {
  NEEDS_REVIEW: 0,
  CANDIDATE: 1,
  AMBIGUOUS: 2,
  NONE: 3,
  CONFIRMED: 4,
  EXCLUDED: 5,
}

/** 쿠팡 리스팅 채널 = 로켓그로스 채널의 대표 채널(판매자배송). 대표가 없으면 RG 채널 자신. */
export async function resolveCoupangListingChannelId(spaceId: string): Promise<string | null> {
  const rgChannel = await prisma.channel.findFirst({
    where: { spaceId, externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH },
    select: { id: true, representativeChannelId: true },
  })
  return rgChannel ? (rgChannel.representativeChannelId ?? rgChannel.id) : null
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
      excludedAt: true,
    },
  })
  if (items.length === 0) return []

  const listingChannelId = await resolveCoupangListingChannelId(spaceId)
  const listings = listingChannelId
    ? await prisma.productListing.findMany({
        where: { spaceId, channelId: listingChannelId },
        select: LISTING_SELECT,
      })
    : []

  // vendorItemId(=재고 optionId) → skuId : 최신 재고건전성 스냅샷에서.
  const ws = await resolveCoupangWorkspaceForSpace(spaceId)
  const skuByVendorItemId = new Map<string, string>()
  const productNameByVendorItemId = new Map<string, string>()
  const compositionBySku = new Map<string, Array<{ optionId: string; quantity: number }>>()
  if (ws) {
    const latest = await prisma.inventoryRecord.findFirst({
      where: { workspaceId: ws.workspaceId, fileType: 'INVENTORY_HEALTH' },
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    if (latest) {
      const records = await prisma.inventoryRecord.findMany({
        where: {
          workspaceId: ws.workspaceId,
          fileType: 'INVENTORY_HEALTH',
          snapshotDate: latest.snapshotDate,
        },
        select: { optionId: true, skuId: true, productName: true },
      })
      for (const r of records) {
        if (!r.optionId) continue
        if (r.skuId) skuByVendorItemId.set(String(r.optionId), String(r.skuId))
        if (r.productName) productNameByVendorItemId.set(String(r.optionId), r.productName)
      }
    }
    const maps = await prisma.invLocationProductMap.findMany({
      where: { locationId: ws.locationId },
      select: { externalCode: true, items: { select: { optionId: true, quantity: true } } },
    })
    for (const m of maps) compositionBySku.set(m.externalCode, m.items)
  }

  const computed = computeMatchCandidates({
    items: items.map((i) => ({ ...i, excluded: i.excludedAt != null })),
    skuByVendorItemId,
    compositionBySku,
    listings: listings.map((l) => ({ id: l.id, items: l.items })),
  })
  const listingById = new Map(listings.map((l) => [l.id, summarize(l as LoadedListing)]))
  // 확정 리스팅이 다른 채널(대표 채널 변경 등)이면 따로 가져온다.
  const missing = items
    .filter((i) => i.listingId && !listingById.has(i.listingId))
    .map((i) => i.listingId!)
  if (missing.length) {
    const extra = await prisma.productListing.findMany({
      where: { id: { in: missing }, spaceId },
      select: LISTING_SELECT,
    })
    for (const l of extra) listingById.set(l.id, summarize(l as LoadedListing))
  }
  const listingOf = (id: string): MatchingListing =>
    listingById.get(id) ?? { id, name: id, retailPrice: null, composition: [] }

  const productNameOf = (i: { rgVendorItemId: string | null }) =>
    i.rgVendorItemId ? (productNameByVendorItemId.get(i.rgVendorItemId) ?? null) : null
  const itemById = new Map(items.map((i) => [i.id, i]))
  const labelOf = (id: string) => {
    const it = itemById.get(id)
    if (!it) return id
    return [productNameOf(it), it.itemName].filter(Boolean).join(' / ') || it.sellerProductId
  }

  return items
    .map((i) => {
      const c = computed.get(i.id)!
      return {
        id: i.id,
        productName: productNameOf(i),
        itemName: i.itemName,
        sellerProductId: i.sellerProductId,
        rgVendorItemId: i.rgVendorItemId,
        mpVendorItemId: i.mpVendorItemId,
        rgSalePrice: i.rgSalePrice,
        mpSalePrice: i.mpSalePrice,
        collectedAt: i.collectedAt.toISOString(),
        status: c.status,
        conflicts: c.conflictItemIds.map((id) => ({ id, label: labelOf(id) })),
        stopSuggested: (productNameOf(i) ?? i.itemName ?? '').includes('판매중지'),
        basisSku:
          i.rgVendorItemId && compositionBySku.has(skuByVendorItemId.get(i.rgVendorItemId) ?? '')
            ? (skuByVendorItemId.get(i.rgVendorItemId) ?? null)
            : null,
        listing: i.listingId ? listingOf(i.listingId) : null,
        candidates: c.candidateListingIds.map(listingOf),
      }
    })
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        (a.itemName ?? '').localeCompare(b.itemName ?? '')
    )
}
