// Stock Status API 응답 타입 — `/api/sh/inventory/stock-status`

export type LocationType = 'OWN' | 'THIRD_PARTY' | 'STORE'
export type SkuStatus = 'OK' | 'LOW' | 'OUT'
export type AlertSeverity = 'OUT' | 'LOW'

export type HealthDistribution = {
  ok: number
  low: number
  out: number
  total: number
}

export type StockKpis = {
  totalBrands: number
  totalSkus: number
  totalQty: number
  totalValue: number
  lowStockCount: number
  averageTurnoverDays: number | null
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

export type StockLocation = {
  id: string
  name: string
  type: LocationType
  skuCount: number
  totalQty: number
  totalValue: number
  healthDistribution: HealthDistribution
}

export type StockMatrixRow = {
  optionId: string
  sku: string | null
  optionName: string
  productId: string
  productName: string
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
  status: SkuStatus
  turnoverDays: number | null
}

export type StockAlert = {
  optionId: string
  sku: string | null
  productName: string
  severity: AlertSeverity
  qty: number
  safetyStockQty: number
  message: string
  occurredAt: string
}

export type StockStatusResponse = {
  snapshotAt: string
  kpis: StockKpis
  brands: StockBrand[]
  locations: StockLocation[]
  matrix: { rows: StockMatrixRow[] }
  alerts: StockAlert[]
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
}
