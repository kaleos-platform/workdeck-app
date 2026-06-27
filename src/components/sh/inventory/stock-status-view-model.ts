import type { SkuStatus, StockMatrixRow, StockProductSummary } from './stock-status.types'

export type StockStatusRowView = StockMatrixRow & {
  displayQty: number
  displayStatus: SkuStatus
}

export type StockStatusProductCard = StockProductSummary & {
  brandId: string | null
  brandName: string | null
  groupId: string
  groupName: string
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
      brandId: row.brandId,
      brandName: row.brandName,
      groupId: row.groupId,
      groupName: row.groupName,
    }
    if (!existing) {
      productMap.set(row.productId, {
        ...patch,
        optionCount: 1,
        okOptionCount: nextStatus === 'OK' ? 1 : 0,
        lowOptionCount: nextStatus === 'LOW' ? 1 : 0,
        outOptionCount: nextStatus === 'OUT' ? 1 : 0,
        overOptionCount: nextStatus === 'OVER' ? 1 : 0,
      })
      continue
    }

    existing.optionCount += 1
    if (nextStatus === 'OK') existing.okOptionCount += 1
    else if (nextStatus === 'LOW') existing.lowOptionCount += 1
    else if (nextStatus === 'OUT') existing.outOptionCount += 1
    else existing.overOptionCount += 1
  }

  return Array.from(productMap.values()).sort((a, b) =>
    a.productName.localeCompare(b.productName, 'ko')
  )
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
    return [product.productName, product.brandName ?? '', product.groupName]
      .join(' ')
      .toLowerCase()
      .includes(q)
  })

  return [...filtered].sort((a, b) => {
    const aPinned = pinned.has(a.productId)
    const bPinned = pinned.has(b.productId)
    if (aPinned !== bPinned) return aPinned ? -1 : 1
    return a.productName.localeCompare(b.productName, 'ko')
  })
}
