import type { SkuStatus, StockMatrixRow, StockProductSummary } from './stock-status.types'

export type StockStatusRowView = StockMatrixRow & {
  displayQty: number
  displayStatus: SkuStatus
}

export type StockStatusProductCard = StockProductSummary & {
  /** 관리용 상품명 — 비어있으면 공식 상품명(productName)으로 fallback */
  productInternalName: string | null
  brandId: string | null
  brandName: string | null
  groupId: string
  groupName: string
  /** 상품 내 옵션 합계 — 정렬 기준 */
  out30d: number
  totalQty: number
}

/** 화면 표시명 — 관리용 상품명 우선, 없으면 공식 상품명 */
export function stockStatusDisplayName(product: {
  productName: string
  productInternalName: string | null
}): string {
  const internal = product.productInternalName?.trim()
  return internal ? internal : product.productName
}

/** 30일 출고량 desc → 총재고 desc → 표시명 오름차순 */
function compareProductCards(a: StockStatusProductCard, b: StockStatusProductCard): number {
  if (a.out30d !== b.out30d) return b.out30d - a.out30d
  if (a.totalQty !== b.totalQty) return b.totalQty - a.totalQty
  return stockStatusDisplayName(a).localeCompare(stockStatusDisplayName(b), 'ko')
}

export type StockStatusProductFilters = {
  brandId: string | null
  groupId: string | null
  pinnedProductIds: string[]
  query: string
}

export const STOCK_STATUS_BRAND_NONE = '__none__'

export function scopeStockStatusRows(
  rows: StockMatrixRow[],
  locationId: string | null
): StockStatusRowView[] {
  if (!locationId) {
    return rows.map((row) => ({
      ...row,
      displayQty: row.totalQty,
      displayStatus: row.status,
    }))
  }

  return rows
    .filter((row) => row.byLocation[locationId] !== undefined)
    .map((row) => ({
      ...row,
      displayQty: row.totalQty,
      displayStatus: row.status,
    }))
}

export function buildStockStatusProducts(
  rows: StockMatrixRow[],
  locationId: string | null
): StockStatusProductCard[] {
  const scoped = scopeStockStatusRows(rows, locationId)
  const productMap = new Map<string, StockStatusProductCard>()

  for (const row of scoped) {
    const existing = productMap.get(row.productId)
    const nextStatus = row.displayStatus
    const patch = {
      productId: row.productId,
      productName: row.productName,
      productInternalName: row.productInternalName,
      brandId: row.brandId,
      brandName: row.brandName,
      groupId: row.groupId,
      groupName: row.groupName,
    }
    if (!existing) {
      productMap.set(row.productId, {
        ...patch,
        out30d: row.out30d,
        totalQty: row.displayQty,
        optionCount: 1,
        okOptionCount: nextStatus === 'OK' ? 1 : 0,
        lowOptionCount: nextStatus === 'LOW' ? 1 : 0,
        outOptionCount: nextStatus === 'OUT' ? 1 : 0,
        overOptionCount: nextStatus === 'OVER' ? 1 : 0,
      })
      continue
    }

    existing.optionCount += 1
    existing.out30d += row.out30d
    existing.totalQty += row.displayQty
    if (nextStatus === 'OK') existing.okOptionCount += 1
    else if (nextStatus === 'LOW') existing.lowOptionCount += 1
    else if (nextStatus === 'OUT') existing.outOptionCount += 1
    else existing.overOptionCount += 1
  }

  return Array.from(productMap.values()).sort(compareProductCards)
}

export function filterStockStatusProducts(
  products: StockStatusProductCard[],
  filters: StockStatusProductFilters
): StockStatusProductCard[] {
  const q = filters.query.trim().toLowerCase()
  const pinned = new Set(filters.pinnedProductIds)

  const filtered = products.filter((product) => {
    if (filters.brandId === STOCK_STATUS_BRAND_NONE) {
      if (product.brandId !== null) return false
    } else if (filters.brandId && product.brandId !== filters.brandId) {
      return false
    }
    if (filters.groupId && product.groupId !== filters.groupId) return false
    if (!q) return true
    return [
      product.productName,
      product.productInternalName ?? '',
      product.brandName ?? '',
      product.groupName,
    ]
      .join(' ')
      .toLowerCase()
      .includes(q)
  })

  return [...filtered].sort((a, b) => {
    const aPinned = pinned.has(a.productId)
    const bPinned = pinned.has(b.productId)
    if (aPinned !== bPinned) return aPinned ? -1 : 1
    return compareProductCards(a, b)
  })
}
