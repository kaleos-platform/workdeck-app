// 가격 시뮬레이션 시나리오 — 라이브 상태 스냅샷 계약 (단일 소스)
//
// PricingQuickFlow 의 라이브 상태를 무손실 직렬화해 저장/복원한다.
// 서버(API)·클라이언트(시뮬 화면)·임시저장(localStorage)이 모두 이 타입을 공유한다.
// 정규화 테이블(PricingScenarioItem/Channel) 대신 이 JSON 스냅샷이 복원의 단일 소스다.

import type { ResolvedComponent } from '@/components/sh/products/pricing-sim/pricing-bundle-row'
import type { PromotionValue } from '@/components/sh/products/pricing-sim/pricing-promotion-card'

/** 좌측 라이브 시뮬 설정 (전 채널 공통) */
export type SnapLiveSim = {
  targetMargin: number // 0~1
  minMargin: number // 0~1
  includeVat: boolean
  vatRate: number // 0~1
  returnRate: number // 0~1
  returnHandling: number // 원/건
}

/** 채널별 비용 override */
export type SnapChOverride = {
  feePct: number // 0~100 (UI %)
  shippingFeeType: 'FIXED' | 'PERCENT'
  shippingFee: number // 원
  shippingFeePct: number // 0~1
  paymentFeeIncluded: boolean
  paymentFeePct: number // 0~1
  applyAdCost: boolean
  adPct: number // 0~1
}

/** 내역 카드/요약 표시용 (스냅샷 저장 시점에 계산해 함께 보관) */
export type PricingSimSummary = {
  productNames: string[]
  channelCount: number
  targetMarginPct: number // 0~100 정수
  priceMin: number | null // 권장가 범위
  priceMax: number | null
  totalCost: number // 번들 총 원가
}

/** 시뮬 화면 전체 상태 스냅샷 (버전 태그 포함) */
export type PricingSimSnapshot = {
  v: 1
  live: SnapLiveSim
  rows: ResolvedComponent[]
  bundleNameInput: string
  selectedChannelIds: string[]
  chOverrides: Record<string, SnapChOverride>
  promotion: PromotionValue
  snap: boolean
  summary: PricingSimSummary
}

/** 작성중 내용 임시저장 localStorage 키 */
export const PRICING_DRAFT_KEY = 'sh-pricing-sim-draft'

/**
 * localStorage/DB에서 읽은 임의 JSON을 방어적으로 PricingSimSnapshot으로 파싱한다.
 * 형태가 어긋나면 null (조용히 버림 — 복원 실패는 치명적이지 않다).
 */
export function parseSnapshot(raw: unknown): PricingSimSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.v !== 1) return null
  if (typeof o.live !== 'object' || o.live === null) return null
  if (!Array.isArray(o.rows)) return null
  if (!Array.isArray(o.selectedChannelIds)) return null
  if (typeof o.chOverrides !== 'object' || o.chOverrides === null) return null
  if (typeof o.promotion !== 'object' || o.promotion === null) return null
  // 신뢰 후 구조 반환 (필드 단위 강제 변환은 과함 — 자체 생성 데이터)
  return {
    v: 1,
    live: o.live as SnapLiveSim,
    rows: o.rows as ResolvedComponent[],
    bundleNameInput: typeof o.bundleNameInput === 'string' ? o.bundleNameInput : '',
    selectedChannelIds: o.selectedChannelIds as string[],
    chOverrides: o.chOverrides as Record<string, SnapChOverride>,
    promotion: o.promotion as PromotionValue,
    snap: o.snap !== false,
    summary: (o.summary as PricingSimSummary) ?? {
      productNames: [],
      channelCount: 0,
      targetMarginPct: 0,
      priceMin: null,
      priceMax: null,
      totalCost: 0,
    },
  }
}

/** 스냅샷이 "의미있는" 내용을 담고 있는지 (임시저장 가치 판단) */
export function isMeaningfulSnapshot(s: PricingSimSnapshot): boolean {
  return s.rows.length > 0 || s.selectedChannelIds.length > 0
}
