import type { ProductListingStatus } from '@/generated/prisma/enums'

/**
 * 판매채널 상품(Listing)의 자동 계산 유틸.
 *
 * 가용재고(availableStock) = min(floor(optionStock / item.quantity)) over composition items.
 *   → 물리 재고(InvStockLevel)에서만 파생. 채널 재고 캡은 적용하지 않는다.
 * 소비자가격 = Σ (option.retailPrice × item.quantity). 하나라도 null이면 전체 null.
 * effectiveStatus = 채널 재고 0 이하(설정 시) 또는 가용재고 0 이하 → SOLD_OUT.
 *   단 사용자 SUSPENDED 설정은 오버라이드 X.
 *
 * 가격은 number(원 단위)로 다룬다 — Prisma Decimal은 상위에서 toNumber() 변환해 전달.
 */

export type ListingItemStockSnapshot = {
  quantity: number
  optionStock: number
}

export type ListingItemPriceSnapshot = {
  quantity: number
  retailPrice: number | null
}

export type EffectiveListingStatus = 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'

export function computeListingAvailableStock(items: ListingItemStockSnapshot[]): number {
  if (items.length === 0) return 0
  let min = Infinity
  for (const it of items) {
    const per = Math.max(1, it.quantity)
    const available = Math.floor(it.optionStock / per)
    if (available < min) min = available
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0
}

/**
 * 위치별 가용재고 분해.
 * 각 위치에서 "그 위치 재고만으로 만들 수 있는 세트 수"를 계산한다.
 *
 * 주의: 위치별 합 ≤ 풀링(전체 합산) 가용재고. 교차 위치 풀링으로 만들 수 있는 세트는
 * 위치별 관점에서는 잡히지 않으므로, 이 분해는 가산 분해가 아닌 정보성 표시다.
 */
export type ListingLocationStockSnapshot = {
  locationId: string
  items: ListingItemStockSnapshot[]
}

export function computeListingAvailableStockByLocation(
  locations: ListingLocationStockSnapshot[]
): Array<{ locationId: string; availableStock: number }> {
  return locations.map((loc) => ({
    locationId: loc.locationId,
    availableStock: computeListingAvailableStock(loc.items),
  }))
}

export function computeListingRetailBaseline(items: ListingItemPriceSnapshot[]): number | null {
  if (items.length === 0) return null
  let total = 0
  for (const it of items) {
    if (it.retailPrice == null) return null
    total += it.retailPrice * it.quantity
  }
  return total
}

export function computeEffectiveStatus(
  status: ProductListingStatus,
  availableStock: number,
  channelStock?: number | null
): EffectiveListingStatus {
  if (status === 'SUSPENDED') return 'SUSPENDED'
  // 채널 재고가 설정돼 있고(non-null) 0 이하면 품절. 미설정(null)이면 채널-품절 판정 안 함.
  const channelSoldOut = channelStock != null && channelStock <= 0
  return channelSoldOut || availableStock <= 0 ? 'SOLD_OUT' : 'ACTIVE'
}

export function computeDiscount(
  baseline: number | null,
  sale: number | null
): { diff: number | null; percent: number | null } {
  if (baseline == null || sale == null) return { diff: null, percent: null }
  const diff = baseline - sale
  const percent = baseline === 0 ? null : (diff / baseline) * 100
  return { diff, percent }
}
