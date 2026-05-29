/**
 * 재고 메트릭 — 단일 정의 / 단일 계산 지점.
 *
 * 모든 함수는 순수함수. fact row 배열을 받아 상태/비율/회전일/롤업을 산출한다.
 * KPI · 트리 · 매트릭스 · 위치 카드 · 알림이 모두 이 함수들을 거쳐 동일 숫자를 본다.
 *
 * 회전일(DOH)은 현재 on_hand 기반 단순화 수식:
 *   turnoverDays = onHand / (outboundQty30d / 30)
 * 정확한 AvgOnHand는 일별 스냅샷 도입 시 향상 가능. 분모 0이면 null.
 */

export type StatusLabel = 'OK' | 'LOW' | 'OUT'

/** SKU × 위치 단위 fact row */
export type CellFact = {
  optionId: string
  locationId: string
  available: number
  safetyAtCell: number
}

/** SKU 단위 집계 row */
export type SkuFact = {
  optionId: string
  totalAvailable: number
  totalSafetyStock: number
}

export type HealthDistribution = {
  ok: number
  low: number
  out: number
  total: number
}

// ────────────────────────────────────────────────────────────
// 상태 판정
// ────────────────────────────────────────────────────────────

/**
 * 옵션별 safetyStockQty 미설정(0) 시 사용하는 기본 부족 임계값.
 * 재고 ≤ LOW_STOCK_THRESHOLD → 부족(LOW), 재고 ≤ 0 → 결품(OUT).
 */
export const LOW_STOCK_THRESHOLD = 10

/** 셀(SKU × 위치) 단위 상태 판정 */
export function statusForCell(available: number, safetyAtCell: number): StatusLabel {
  if (available <= 0) return 'OUT'
  if (safetyAtCell > 0) {
    if (available < safetyAtCell) return 'LOW'
  } else if (available <= LOW_STOCK_THRESHOLD) {
    return 'LOW'
  }
  return 'OK'
}

/** SKU 단위 종합 상태 판정 (Σ available, Σ safety) */
export function statusForSku(totalAvailable: number, totalSafetyStock: number): StatusLabel {
  if (totalAvailable <= 0) return 'OUT'
  if (totalSafetyStock > 0) {
    if (totalAvailable < totalSafetyStock) return 'LOW'
  } else if (totalAvailable <= LOW_STOCK_THRESHOLD) {
    return 'LOW'
  }
  return 'OK'
}

// ────────────────────────────────────────────────────────────
// 헬스 비율
// ────────────────────────────────────────────────────────────

/** 셀 단위 분포 — 위치 분포 카드의 게이지 세그먼트 */
export function healthRatioByCell(cells: CellFact[]): HealthDistribution {
  const dist: HealthDistribution = { ok: 0, low: 0, out: 0, total: cells.length }
  for (const c of cells) {
    const s = statusForCell(c.available, c.safetyAtCell)
    if (s === 'OK') dist.ok += 1
    else if (s === 'LOW') dist.low += 1
    else dist.out += 1
  }
  return dist
}

/** SKU 단위 분포 — KPI lowStockCount, 트리 노드, 매트릭스 합계 */
export function healthRatioBySku(skus: SkuFact[]): HealthDistribution {
  const dist: HealthDistribution = { ok: 0, low: 0, out: 0, total: skus.length }
  for (const s of skus) {
    const status = statusForSku(s.totalAvailable, s.totalSafetyStock)
    if (status === 'OK') dist.ok += 1
    else if (status === 'LOW') dist.low += 1
    else dist.out += 1
  }
  return dist
}

// ────────────────────────────────────────────────────────────
// 회전일 (DOH 단순화)
// ────────────────────────────────────────────────────────────

/**
 * 회전일 = onHand ÷ (outbound / windowDays).
 * 분모 0이면 null. 음수 onHand는 0으로 처리.
 */
export function turnoverDays(onHand: number, outboundQty: number, windowDays = 30): number | null {
  if (windowDays <= 0) return null
  const dailyOut = outboundQty / windowDays
  if (dailyOut <= 0) return null
  const stock = Math.max(0, onHand)
  return Math.round((stock / dailyOut) * 10) / 10
}
