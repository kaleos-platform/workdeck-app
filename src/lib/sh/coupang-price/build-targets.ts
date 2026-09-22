import { roundPriceTo10, ceilMinPriceTo10, checkPriceGuards } from './price-round'

export type BuildTargetsInput = {
  channelAxis: 'RG' | 'MP'
  /** 시뮬의 채널 판매가 — 할인·프로모션 적용 전 */
  salePrice: number
  /** recommendedRetail.min — 최소허용마진 달성가 */
  minMarginPrice: number
  includeVat: boolean
  now: Date
  listings: Array<{ id: string; name: string }>
  items: Array<{
    listingId: string
    rgVendorItemId: string | null
    mpVendorItemId: string | null
    rgSalePrice: number | null
    mpSalePrice: number | null
    collectedAt: Date
    sellerProductId: string
  }>
}

export type PreviewTarget = {
  listingId: string
  listingName: string
  vendorItemId: string | null // null = 지연 매핑 미완료 → 피커 필요
  currentPrice: number | null
  snapshotAgeHours: number | null
  targetPrice: number
  apMinSalePrice: number
  deltaPct: number | null
  blockedReason: string | null
  // Wing 딥링크용 — CoupangProductItem.sellerProductId(=vendorInventoryId). 미연결이면 null
  sellerProductId: string | null
}

export function buildPreviewTargets(input: BuildTargetsInput): PreviewTarget[] {
  const targetPrice = roundPriceTo10(input.salePrice)
  const apMinSalePrice = ceilMinPriceTo10(input.minMarginPrice)
  const guard = checkPriceGuards({
    price: targetPrice,
    apMinSalePrice,
    includeVat: input.includeVat,
  })
  const byListing = new Map(input.items.map((i) => [i.listingId, i]))

  return input.listings.map((l) => {
    const item = byListing.get(l.id)
    const vendorItemId = item
      ? input.channelAxis === 'RG'
        ? item.rgVendorItemId
        : item.mpVendorItemId
      : null
    const currentPrice = item
      ? input.channelAxis === 'RG'
        ? item.rgSalePrice
        : item.mpSalePrice
      : null

    const blockedReason = !guard.ok
      ? guard.reason
      : !vendorItemId
        ? '쿠팡 옵션이 연결되지 않았습니다. 연결한 뒤 반영할 수 있습니다'
        : null

    return {
      listingId: l.id,
      listingName: l.name,
      vendorItemId,
      currentPrice,
      snapshotAgeHours: item
        ? Math.round((input.now.getTime() - item.collectedAt.getTime()) / 3_600_000)
        : null,
      targetPrice,
      apMinSalePrice,
      deltaPct:
        currentPrice && currentPrice > 0 ? (targetPrice - currentPrice) / currentPrice : null,
      blockedReason,
      sellerProductId: item?.sellerProductId ?? null,
    }
  })
}
