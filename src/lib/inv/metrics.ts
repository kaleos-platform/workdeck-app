/**
 * 재고 메트릭 — 단일 정의 / 단일 계산 지점.
 *
 * 모든 함수는 순수함수. fact row 배열을 받아 상태/비율/롤업을 산출한다.
 * KPI · 트리 · 매트릭스가 모두 이 함수들을 거쳐 동일 숫자를 본다.
 *
 * 상태 판정 기준 (실제 출고량 기반):
 *   OUT  : 재고 없음 (stock <= 0)
 *   OK   : 90일 무출고 — 판매 데이터 부족으로 과잉 오분류 방지 (데이터 없음 → 안전 처리)
 *   LOW  : stock < out30d — 최근 30일 출고량보다 재고 적음
 *   OVER : stock > out90d — 최근 90일 출고량보다 재고 많음 (과잉)
 *   OK   : 위 조건 모두 해당 없음
 *
 * 참고: out90d >= out30d 항상 성립 (90일 ⊇ 30일) → LOW와 OVER는 동시 발화 불가.
 */

export type StatusLabel = 'OK' | 'LOW' | 'OUT' | 'OVER'

/** SKU 단위 집계 row */
export type SkuFact = {
  optionId: string
  stock: number
  out30d: number
  out90d: number
}

export type HealthDistribution = {
  ok: number
  low: number
  out: number
  over: number
  total: number
}

// ────────────────────────────────────────────────────────────
// 상태 판정
// ────────────────────────────────────────────────────────────

/**
 * SKU 단위 종합 상태 판정 (실제 출고량 기반)
 *
 * 판정 순서:
 *   1. stock <= 0              → OUT  (결품)
 *   2. out90d === 0            → OK   (90일 무출고: 판매 데이터 부족 → 과잉 오분류 방지)
 *   3. stock < out30d          → LOW  (부족: 최근 30일 출고량보다 재고 적음)
 *   4. stock > out90d          → OVER (과잉: 최근 90일 출고량보다 재고 많음)
 *   5. 그 외                   → OK
 *
 * 참고: out90d >= out30d 항상 성립 (90일 ⊇ 30일) → 3과 4는 동시 발화 불가.
 */
export function statusForSku(stock: number, out30d: number, out90d: number): StatusLabel {
  // 데이터 이상(채널 정정 등)으로 out30d > out90d가 들어와도 불변식을 강제 — 90일은 30일을 포함하므로 항상 ≥.
  const safeOut90d = Math.max(out90d, out30d)
  if (stock <= 0) return 'OUT'
  if (safeOut90d === 0) return 'OK'
  if (stock < out30d) return 'LOW'
  if (stock > safeOut90d) return 'OVER'
  return 'OK'
}

// ────────────────────────────────────────────────────────────
// 헬스 비율
// ────────────────────────────────────────────────────────────

/** SKU 단위 분포 — KPI lowStockCount, 트리 노드, 매트릭스 합계 */
export function healthRatioBySku(skus: SkuFact[]): HealthDistribution {
  const dist: HealthDistribution = { ok: 0, low: 0, out: 0, over: 0, total: skus.length }
  for (const s of skus) {
    const status = statusForSku(s.stock, s.out30d, s.out90d)
    if (status === 'OK') dist.ok += 1
    else if (status === 'LOW') dist.low += 1
    else if (status === 'OUT') dist.out += 1
    else dist.over += 1
  }
  return dist
}
