// 가격 시나리오 목록/패널 공용 타입·포맷 헬퍼

import type { PricingSimSummary } from '@/lib/sh/pricing-scenario-snapshot'

/** GET /api/sh/pricing-scenarios 목록 항목 */
export type ScenarioRow = {
  id: string
  name: string
  memo: string | null
  productIds: string[]
  summary: PricingSimSummary | null
  updatedAt: string
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

/** 권장가 범위 표기 (min~max, 동일시 단일, 없으면 —) */
export function priceRangeText(s: PricingSimSummary | null): string {
  if (!s || s.priceMin == null || s.priceMax == null) return '—'
  return s.priceMin === s.priceMax
    ? `₩${fmt(s.priceMin)}`
    : `₩${fmt(s.priceMin)}~${fmt(s.priceMax)}`
}
