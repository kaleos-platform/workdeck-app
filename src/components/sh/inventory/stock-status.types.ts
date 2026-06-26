// Stock Status API 응답 타입 — `/api/sh/inventory/stock-status`

export type LocationType = 'OWN' | 'THIRD_PARTY' | 'STORE'
export type SkuStatus = 'OK' | 'LOW' | 'OUT' | 'OVER'

export type HealthDistribution = {
  ok: number
  low: number
  out: number
  over: number
  total: number
}

export type StockKpis = {
  totalSkus: number
  totalQty: number
  totalValue: number
  lowStockCount: number
}

export type StockBrandGroup = {
  id: string
  name: string
  productCount: number
  skuCount: number
  totalQty: number
  totalValue: number
  healthRatio: HealthDistribution
}

export type StockBrand = {
  id: string | null
  name: string
  logoUrl: string | null
  groups: StockBrandGroup[]
  healthRatio: HealthDistribution
}

export type LocationProductBreakdown = {
  productId: string
  productName: string
  qty: number
}

export type StockLocation = {
  id: string
  name: string
  type: LocationType
  skuCount: number
  totalQty: number
  totalValue: number
  /** 도넛 드릴다운용 — 필터 무관 전체 기준, qty 내림차순 */
  productBreakdown: LocationProductBreakdown[]
}

export type StockProductSummary = {
  productId: string
  productName: string
  optionCount: number
  okOptionCount: number
  lowOptionCount: number
  outOptionCount: number
  overOptionCount: number
}

export type StockMatrixRow = {
  optionId: string
  sku: string | null
  optionName: string
  productId: string
  productName: string
  productInternalName: string | null
  productCode: string | null
  brandId: string | null
  brandName: string | null
  groupId: string
  groupName: string
  costPrice: number | null
  retailPrice: number | null
  safetyStockQty: number
  totalQty: number
  totalValue: number
  byLocation: Record<string, number>
  externalCodeByLocation: Record<string, string>
  incomingQty: number
  out30d: number
  out90d: number
  status: SkuStatus
}

export type StockStatusResponse = {
  snapshotAt: string
  kpis: StockKpis
  overallHealth: HealthDistribution
  brands: StockBrand[]
  locations: StockLocation[]
  products: StockProductSummary[]
  matrix: { rows: StockMatrixRow[] }
  groups: unknown[]
}

export const LOCATION_TYPE_LABEL: Record<LocationType, string> = {
  OWN: '자사창고',
  THIRD_PARTY: '3PL',
  STORE: '매장',
}

export const STATUS_LABEL: Record<SkuStatus, string> = {
  OK: '정상',
  LOW: '부족',
  OUT: '결품',
  OVER: '과잉',
}
