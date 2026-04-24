import type { ProductListingStatus } from '@/generated/prisma/enums'

/**
 * 판매채널 상품(Listing)의 자동 계산 유틸.
 *
 * 재고 수량 = min(floor(optionStock / item.quantity)) over composition items.
 * 소비자가격 = Σ (option.retailPrice × item.quantity). 하나라도 null이면 전체 null.
 * effectiveStatus = 재고 0 → SOLD_OUT (단 사용자 SUSPENDED 설정은 오버라이드 X).
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
  availableStock: number
): EffectiveListingStatus {
  if (status === 'SUSPENDED') return 'SUSPENDED'
  return availableStock <= 0 ? 'SOLD_OUT' : 'ACTIVE'
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
