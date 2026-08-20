// 가격 시나리오 목록/패널 공용 타입·포맷 헬퍼

import type { PricingSimSummary } from '@/lib/sh/pricing-scenario-snapshot'

/** GET /api/sh/pricing-scenarios 목록 항목 */
export type ScenarioRow = {
  id: string
  name: string
  memo: string | null
  productIds: string[]
  channelIds?: string[]
  channelNames?: string[]
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

/** 소비자가 표기 (없으면 —) */
export function retailText(s: PricingSimSummary | null): string {
  return s?.retail != null ? `₩${fmt(s.retail)}` : '—'
}

/** 채널별 설정 판매가 범위 표기 (min~max, 동일시 단일, 없으면 —) */
export function salePriceRangeText(s: PricingSimSummary | null): string {
  if (!s || s.salePriceMin == null || s.salePriceMax == null) return '—'
  return s.salePriceMin === s.salePriceMax
    ? `₩${fmt(s.salePriceMin)}`
    : `₩${fmt(s.salePriceMin)}~${fmt(s.salePriceMax)}`
}

/** 소비자가 대비 할인율 범위 표기 (0~1 → %, 동일시 단일, 없으면 —) */
export function discountRangeText(s: PricingSimSummary | null): string {
  if (!s || s.discountMin == null || s.discountMax == null) return '—'
  const a = Math.round(s.discountMin * 100)
  const b = Math.round(s.discountMax * 100)
  return a === b ? `${b}%` : `${a}~${b}%`
}
