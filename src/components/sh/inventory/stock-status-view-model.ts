import {
  DEFAULT_STOCK_GRADE_SETTINGS,
  type StockGradeSettings,
} from '@/lib/sh/stock-grade-settings'
import type { StockLocation, StockMatrixRow } from './stock-status.types'

/**
 * 화면 전용 재고 등급 — 커버 일수(재고 ÷ 일평균 출고)를 상품별 리드타임과 비교한다.
 * API의 `status`(OK/LOW/OUT/OVER)는 발주 계획·MCP 에이전트가 함께 쓰므로 건드리지 않는다.
 *
 *   NO_OUTBOUND : 30·90일 출고가 모두 0 (부자재·미입고 신규 옵션) — 조치 카운트에서 제외
 *   NO_STOCK    : 출고는 있는데 재고 ≤ 0 (음수면 장부 이상)
 *   RISK        : 커버 일수 < 리드타임   (지금 발주해도 늦음)
 *   REORDER     : 커버 일수 < 리드타임×2 (발주할 시기)
 *   HEALTHY     : 그 이상
 */
export type StockGrade = 'NO_STOCK' | 'RISK' | 'REORDER' | 'HEALTHY' | 'NO_OUTBOUND'

export const STOCK_GRADE_LABEL: Record<StockGrade, string> = {
  NO_STOCK: '재고없음',
  RISK: '위험',
  REORDER: '발주시기',
  HEALTHY: '여유',
  NO_OUTBOUND: '출고없음',
}

/** 긴급한 순 정렬 가중치 — 낮을수록 먼저. */
const GRADE_ORDER: Record<StockGrade, number> = {
  NO_STOCK: 0,
  RISK: 1,
  REORDER: 2,
  HEALTHY: 3,
  NO_OUTBOUND: 4,
}

export type StockGradeResult = {
  grade: StockGrade
  /** 재고가 소진되기까지 남은 일수. 출고가 없으면 null(계산 불가). */
  daysOfCover: number | null
}

/**
 * 일평균 출고 — 설정된 기준 기간을 먼저 보고, 그 기간 출고가 0이면 더 긴 기간으로 폴백한다.
 * 폴백을 두는 이유: 30일 고정으로 두면 계절성 상품이 비수기에 '출고없음'으로 빠져
 * 조치 목록에서 사라진다. out30d/out90d 는 `channelId != null` OUTBOUND 만 집계되므로
 * 부자재·포장재는 어느 기간이든 0이다.
 */
export function dailyAvgOutbound(
  out30d: number,
  out90d: number,
  avgWindow: StockGradeSettings['avgWindow'] = 'auto'
): number {
  if (avgWindow === 90) return out90d > 0 ? out90d / 90 : 0
  // 'auto' 와 30 은 같은 동작 — 30일을 먼저 보고 없으면 90일로 폴백한다.
  if (out30d > 0) return out30d / 30
  if (out90d > 0) return out90d / 90
  return 0
}

export function gradeStock(
  qty: number,
  out30d: number,
  out90d: number,
  leadTimeDays: number,
  settings: StockGradeSettings = DEFAULT_STOCK_GRADE_SETTINGS,
  safetyStockQty = 0
): StockGradeResult {
  const avg = dailyAvgOutbound(out30d, out90d, settings.avgWindow)
  // 출고 이력이 없으면 커버 일수를 만들 수 없다. 재고 0 이어도 '품절'이 아니라 '미입고'다.
  if (avg <= 0) return { grade: 'NO_OUTBOUND', daysOfCover: null }
  // 재고없음 판정은 **실재고 기준**이다. 안전재고를 빼고 판정하면 재고가 남아 있는데도
  // '재고없음'이 되어 요약의 재고없음 카운트가 부풀고 음수 경고와도 어긋난다.
  if (qty <= 0) return { grade: 'NO_STOCK', daysOfCover: 0 }

  // 안전재고 반영은 분자에만 — 안전재고를 건드리지 않고 버틸 수 있는 일수가 된다.
  const usableQty = settings.applySafetyStock ? Math.max(0, qty - safetyStockQty) : qty
  const daysOfCover = usableQty / avg
  // 리드타임 0(즉시 조달)이면 위험 구간이 사라지므로 최소 1일로 본다.
  const lead = Math.max(1, leadTimeDays)
  if (daysOfCover < lead * settings.riskMultiplier) return { grade: 'RISK', daysOfCover }
  if (daysOfCover < lead * settings.reorderMultiplier) return { grade: 'REORDER', daysOfCover }
  return { grade: 'HEALTHY', daysOfCover }
}

export type StockStatusRowView = StockMatrixRow & {
  /** 현재 보기 기준 수량 — 전체 위치면 계획재고(totalQty), 위치 선택 시 그 위치 재고 */
  displayQty: number
  /** 위치 선택 시 null — 위치별 출고 집계가 없어 커버 일수를 만들 수 없다 */
  grade: StockGrade | null
  daysOfCover: number | null
  /** 장부 이상(음수 재고) 표시용 */
  negative: boolean
}

export type StockStatusProductCard = {
  productId: string
  productName: string
  optionCount: number
  /** 관리용 상품명 — 비어있으면 공식 상품명(productName)으로 fallback */
  productInternalName: string | null
  brandId: string | null
  brandName: string | null
  groupId: string
  groupName: string
  /** 상품 내 옵션 합계 — 정렬 기준 (currentQty = 입고예정 제외 현재고) */
  out30d: number
  currentQty: number
  /** 가장 급한 옵션 기준 등급 — 위치 선택 시 null */
  grade: StockGrade | null
  /** 가장 급한 옵션의 커버 일수 */
  daysOfCover: number | null
  noStockOptionCount: number
  riskOptionCount: number
}

/** 화면 표시명 — 관리용 상품명 우선, 없으면 공식 상품명 */
export function stockStatusDisplayName(product: {
  productName: string
  productInternalName: string | null
}): string {
  const internal = product.productInternalName?.trim()
  return internal ? internal : product.productName
}

export type StockStatusSortMode = 'urgent' | 'outbound' | 'name'

export const STOCK_STATUS_SORT_LABEL: Record<StockStatusSortMode, string> = {
  urgent: '긴급한 순',
  outbound: '출고량 순',
  name: '이름 순',
}

/** 30일 출고량 desc → 현재고 desc → 표시명 오름차순 */
function compareByOutbound(a: StockStatusProductCard, b: StockStatusProductCard): number {
  if (a.out30d !== b.out30d) return b.out30d - a.out30d
  if (a.currentQty !== b.currentQty) return b.currentQty - a.currentQty
  return stockStatusDisplayName(a).localeCompare(stockStatusDisplayName(b), 'ko')
}

/** 등급 → 커버 일수 asc → 출고량 정렬. 위치 선택 시(grade null) 출고량 정렬로 떨어진다. */
function compareByUrgency(a: StockStatusProductCard, b: StockStatusProductCard): number {
  if (a.grade === null || b.grade === null) return compareByOutbound(a, b)
  const orderDiff = GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade]
  if (orderDiff !== 0) return orderDiff
  const aDays = a.daysOfCover ?? Number.POSITIVE_INFINITY
  const bDays = b.daysOfCover ?? Number.POSITIVE_INFINITY
  if (aDays !== bDays) return aDays - bDays
  return compareByOutbound(a, b)
}

function compareProductCards(
  a: StockStatusProductCard,
  b: StockStatusProductCard,
  sort: StockStatusSortMode
): number {
  if (sort === 'outbound') return compareByOutbound(a, b)
  if (sort === 'name')
    return stockStatusDisplayName(a).localeCompare(stockStatusDisplayName(b), 'ko')
  return compareByUrgency(a, b)
}

export type StockStatusProductFilters = {
  brandId: string | null
  groupId: string | null
  pinnedProductIds: string[]
  query: string
  sort?: StockStatusSortMode
}

export const STOCK_STATUS_BRAND_NONE = '__none__'

export function scopeStockStatusRows(
  rows: StockMatrixRow[],
  locationId: string | null,
  settings: StockGradeSettings = DEFAULT_STOCK_GRADE_SETTINGS
): StockStatusRowView[] {
  if (!locationId) {
    return rows.map((row) => {
      const { grade, daysOfCover } = gradeStock(
        row.totalQty,
        row.out30d,
        row.out90d,
        row.leadTimeDays,
        settings,
        row.safetyStockQty
      )
      return {
        ...row,
        displayQty: row.totalQty,
        grade,
        daysOfCover,
        negative: row.totalQty < 0,
      }
    })
  }

  // 위치 선택 시: 수량은 그 위치 재고로 좁히되 등급·커버 일수는 계산하지 않는다.
  // 출고량(out30d/out90d)은 위치별 집계가 없어 분모가 전사 값이라, 그대로 나누면
  // 모든 행이 '위험'으로 보이는 거짓 신호가 된다.
  return rows
    .filter((row) => row.byLocation[locationId] !== undefined)
    .map((row) => {
      const qty = row.byLocation[locationId] ?? 0
      return {
        ...row,
        displayQty: qty,
        grade: null,
        daysOfCover: null,
        negative: qty < 0,
      }
    })
}

export function buildStockStatusProducts(
  rows: StockMatrixRow[],
  locationId: string | null,
  settings: StockGradeSettings = DEFAULT_STOCK_GRADE_SETTINGS
): StockStatusProductCard[] {
  const scoped = scopeStockStatusRows(rows, locationId, settings)
  const productMap = new Map<string, StockStatusProductCard>()

  for (const row of scoped) {
    const existing = productMap.get(row.productId)
    if (!existing) {
      productMap.set(row.productId, {
        productId: row.productId,
        productName: row.productName,
        productInternalName: row.productInternalName,
        brandId: row.brandId,
        brandName: row.brandName,
        groupId: row.groupId,
        groupName: row.groupName,
        out30d: row.out30d,
        currentQty: row.currentQty,
        grade: row.grade,
        daysOfCover: row.daysOfCover,
        noStockOptionCount: row.grade === 'NO_STOCK' ? 1 : 0,
        riskOptionCount: row.grade === 'RISK' ? 1 : 0,
        optionCount: 1,
      })
      continue
    }

    existing.optionCount += 1
    existing.out30d += row.out30d
    existing.currentQty += row.currentQty
    if (row.grade === 'NO_STOCK') existing.noStockOptionCount += 1
    if (row.grade === 'RISK') existing.riskOptionCount += 1
    // 상품 대표값 = 가장 급한 옵션 (먼저 품절될 옵션이 발주 판단을 지배한다)
    if (row.grade !== null) {
      const worse =
        existing.grade === null ||
        GRADE_ORDER[row.grade] < GRADE_ORDER[existing.grade] ||
        (GRADE_ORDER[row.grade] === GRADE_ORDER[existing.grade] &&
          (row.daysOfCover ?? Number.POSITIVE_INFINITY) <
            (existing.daysOfCover ?? Number.POSITIVE_INFINITY))
      if (worse) {
        existing.grade = row.grade
        existing.daysOfCover = row.daysOfCover
      }
    }
  }

  return Array.from(productMap.values()).sort((a, b) => compareProductCards(a, b, 'urgent'))
}

export function filterStockStatusProducts(
  products: StockStatusProductCard[],
  filters: StockStatusProductFilters
): StockStatusProductCard[] {
  const q = filters.query.trim().toLowerCase()
  const pinned = new Set(filters.pinnedProductIds)
  const sort = filters.sort ?? 'urgent'

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
    return compareProductCards(a, b, sort)
  })
}

export type StockStatusSummary = {
  riskProductCount: number
  reorderProductCount: number
  noStockOptionCount: number
}

/** 상단 요약 — 필터 적용 전 상품 카드 전체 기준. */
export function summarizeStockStatus(products: StockStatusProductCard[]): StockStatusSummary {
  let riskProductCount = 0
  let reorderProductCount = 0
  let noStockOptionCount = 0
  for (const product of products) {
    if (product.grade === 'NO_STOCK' || product.grade === 'RISK') riskProductCount += 1
    else if (product.grade === 'REORDER') reorderProductCount += 1
    noStockOptionCount += product.noStockOptionCount
  }
  return { riskProductCount, reorderProductCount, noStockOptionCount }
}

/**
 * 표에 그릴 위치 컬럼 — 위치 탭 선택이 우선이고, 그 다음 사용자가 숨긴 위치를 뺀다.
 * 숨김은 **표시 전용**이다: 합계(totalQty)·등급·엑셀 export 는 전 위치 기준을 유지한다.
 * 저장된 hiddenIds 에는 삭제·비활성된 위치가 남아 있을 수 있어 현재 목록과 교집합만 쓴다.
 */
export function resolveVisibleLocations(
  locations: StockLocation[],
  hiddenLocationIds: string[] | Set<string>,
  selectedLocationId: string | null
): StockLocation[] {
  if (selectedLocationId) {
    return locations.filter((l) => l.id === selectedLocationId)
  }
  const hidden = hiddenLocationIds instanceof Set ? hiddenLocationIds : new Set(hiddenLocationIds)
  const visible = locations.filter((l) => !hidden.has(l.id))
  // 전부 숨겨진 상태(설정 꼬임·위치 삭제)면 위치 컬럼 없는 표가 되므로 전체로 되돌린다.
  return visible.length > 0 ? visible : locations
}
