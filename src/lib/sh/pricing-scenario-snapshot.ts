// 가격 시뮬레이션 시나리오 — 라이브 상태 스냅샷 계약 (단일 소스)
//
// PricingQuickFlow 의 라이브 상태를 무손실 직렬화해 저장/복원한다.
// 서버(API)·클라이언트(시뮬 화면)·임시저장(localStorage)이 모두 이 타입을 공유한다.
// 정규화 테이블(PricingScenarioItem/Channel) 대신 이 JSON 스냅샷이 복원의 단일 소스다.
//
// v2: 옵션 조합(탭) 여러 개를 한 시나리오에 담는다. 판매채널 선택·채널 override·
// 시뮬 설정(live)·snap은 시나리오 공통, 상품 구성(rows)·수동 판매가·소비자가 override·
// 프로모션은 탭(variant)별. v1(구 단일 탭)은 읽기 시 탭 1개로 변환해 항상 v2로 다룬다.

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
  /** 선택된 수수료 카테고리명. 구 스냅샷엔 없어 optional(복원 시 '기본' 폴백) */
  feeCategory?: string
  feePct: number // 0~100 (UI %)
  shippingFeeType: 'FIXED' | 'PERCENT'
  shippingFee: number // 원
  shippingFeePct: number // 0~1
  /** 항상 무료배송(판매자 항상 부담). 구 스냅샷엔 없어 optional */
  freeShipping?: boolean
  /** 무료배송 최소 주문금액(원). null/미설정=기준 없음. 구 스냅샷엔 없어 optional */
  freeShippingThreshold?: number | null
  /** 판매 수수료율 VAT 포함 여부. 구 스냅샷엔 없어 optional(복원 시 false 폴백) */
  vatIncludedInFee?: boolean
  /** 결제 수수료율 VAT 포함 여부(판매와 독립). 구 스냅샷엔 없어 optional(복원 시 false 폴백) */
  paymentFeeVatIncluded?: boolean
  paymentFeeIncluded: boolean
  paymentFeePct: number // 0~1
  applyAdCost: boolean
  adPct: number // 0~1
}

/** 시나리오 생성 방식 — 기존 등록 상품 선택 vs 신규 개발 상품 직접 입력 */
export type PricingSimMode = 'existing' | 'new'

/** 내역 카드/요약 표시용 (스냅샷 저장 시점에 계산해 함께 보관) */
export type PricingSimSummary = {
  productNames: string[]
  channelCount: number
  targetMarginPct: number // 0~100 정수
  priceMin: number | null // 권장가 범위 (하위호환 유지)
  priceMax: number | null
  totalCost: number // 번들 총 원가
  /** 생성 방식 (목록 배지용). 구 스냅샷엔 없어 optional (parseSnapshot이 'existing' 폴백) */
  mode?: PricingSimMode
  /** 소비자가(effectiveRetail). 구 스냅샷엔 없어 optional */
  retail?: number | null
  /** 채널별 설정 판매가 범위. 구 스냅샷엔 없어 optional */
  salePriceMin?: number | null
  salePriceMax?: number | null
  /** 소비자가 대비 할인율(판매가 기준, 0~1). 구 스냅샷엔 없어 optional */
  discountMin?: number | null
  discountMax?: number | null
}

/** 옵션 조합(탭) 1개 — 탭별로 독립된 상품 구성·판매가 조정·프로모션 */
export type PricingVariant = {
  id: string
  name: string
  mode: PricingSimMode
  rows: ResolvedComponent[]
  bundleNameInput: string
  /** 채널별 판매가 수동조정값. 없거나 null=권장가 자동 */
  manualPrices?: Record<string, number | null>
  /** 소비자가 override (원). 없거나 null=상품 기본 소비자가 사용 */
  retailOverride?: number | null
  /** 채널별 프로모션. 미설정=프로모션 없음(NONE) */
  chPromotions?: Record<string, PromotionValue>
  /** 탭별 요약 (내역/탭 바 표시용) */
  summary: PricingSimSummary
}

/** 시뮬 화면 전체 상태 스냅샷 (v2, canonical) */
export type PricingSimSnapshot = {
  v: 2
  /** 공통 라이브 시뮬 설정 (전 채널 공통) */
  live: SnapLiveSim
  /** 공통 판매채널 선택 */
  selectedChannelIds: string[]
  /** 공통 채널별 비용 override */
  chOverrides: Record<string, SnapChOverride>
  /** 공통 …900 스냅 토글 */
  snap: boolean
  /** 현재 활성 탭 id. variants에 없으면 복원 시 첫 탭으로 폴백 */
  activeVariantId: string
  /** 옵션 조합(탭) 목록. 항상 1개 이상 */
  variants: PricingVariant[]
  /** 대표 요약 — 목록/히스토리 패널 하위호환(탭 간 합집합·min/max) */
  summary: PricingSimSummary
}

/**
 * @deprecated v1(구 단일 탭) 스냅샷 형태. narrowing·v1→v2 변환용으로만 유지.
 * 신규 코드는 PricingSimSnapshot(v2)만 다룬다.
 */
export type PricingSimSnapshotV1 = {
  v: 1
  mode?: PricingSimMode
  live: SnapLiveSim
  rows: ResolvedComponent[]
  bundleNameInput: string
  selectedChannelIds: string[]
  chOverrides: Record<string, SnapChOverride>
  manualPrices?: Record<string, number | null>
  retailOverride?: number | null
  chPromotions?: Record<string, PromotionValue>
  /** @deprecated 구 전역 프로모션. chPromotions로 대체됨 */
  promotion: PromotionValue
  snap: boolean
  summary: PricingSimSummary
}

/** 작성중 내용 임시저장 localStorage 키 */
export const PRICING_DRAFT_KEY = 'sh-pricing-sim-draft'

function defaultSummary(): PricingSimSummary {
  return {
    productNames: [],
    channelCount: 0,
    targetMarginPct: 0,
    priceMin: null,
    priceMax: null,
    totalCost: 0,
    mode: 'existing',
  }
}

/** v1 raw JSON을 방어적으로 파싱. 형태가 어긋나면 null */
function parseV1(o: Record<string, unknown>): PricingSimSnapshotV1 | null {
  if (typeof o.live !== 'object' || o.live === null) return null
  if (!Array.isArray(o.rows)) return null
  if (!Array.isArray(o.selectedChannelIds)) return null
  if (typeof o.chOverrides !== 'object' || o.chOverrides === null) return null
  if (typeof o.promotion !== 'object' || o.promotion === null) return null
  // 신뢰 후 구조 반환 (필드 단위 강제 변환은 과함 — 자체 생성 데이터)
  return {
    v: 1,
    // 레거시·이상값은 'existing'으로 폴백 (신규 모드는 명시 저장된 경우만)
    mode: o.mode === 'new' ? 'new' : 'existing',
    live: o.live as SnapLiveSim,
    rows: o.rows as ResolvedComponent[],
    bundleNameInput: typeof o.bundleNameInput === 'string' ? o.bundleNameInput : '',
    selectedChannelIds: o.selectedChannelIds as string[],
    chOverrides: o.chOverrides as Record<string, SnapChOverride>,
    manualPrices:
      typeof o.manualPrices === 'object' && o.manualPrices !== null
        ? (o.manualPrices as Record<string, number | null>)
        : undefined,
    retailOverride: typeof o.retailOverride === 'number' ? o.retailOverride : undefined,
    chPromotions:
      typeof o.chPromotions === 'object' && o.chPromotions !== null
        ? (o.chPromotions as Record<string, PromotionValue>)
        : undefined,
    promotion: o.promotion as PromotionValue,
    snap: o.snap !== false,
    summary: (o.summary as PricingSimSummary) ?? defaultSummary(),
  }
}

/**
 * v1(단일 탭) → v2(탭 배열) 변환.
 * 레거시 전역 promotion 폴백(구 quick-flow applySnapshot 로직)을 여기로 이전:
 * chPromotions가 없고 promotion이 NONE이 아니면 선택 채널 전체에 동일 적용.
 */
function v1ToV2(v1: PricingSimSnapshotV1): PricingSimSnapshot {
  const chPromotions =
    v1.chPromotions ??
    (v1.promotion.type !== 'NONE'
      ? Object.fromEntries(v1.selectedChannelIds.map((id) => [id, v1.promotion]))
      : undefined)

  const variant: PricingVariant = {
    id: 'v1',
    name: v1.bundleNameInput || '조합 1',
    mode: v1.mode ?? 'existing',
    rows: v1.rows,
    bundleNameInput: v1.bundleNameInput,
    manualPrices: v1.manualPrices,
    retailOverride: v1.retailOverride,
    chPromotions,
    summary: v1.summary,
  }

  return {
    v: 2,
    live: v1.live,
    selectedChannelIds: v1.selectedChannelIds,
    chOverrides: v1.chOverrides,
    snap: v1.snap,
    activeVariantId: variant.id,
    variants: [variant],
    summary: v1.summary,
  }
}

/** raw 탭 1개를 방어적으로 파싱. rows가 배열이 아니거나 id/name이 문자열이 아니면 null */
function parseVariant(raw: unknown): PricingVariant | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  if (typeof v.id !== 'string' || typeof v.name !== 'string' || !Array.isArray(v.rows)) return null
  return {
    id: v.id,
    name: v.name,
    mode: v.mode === 'new' ? 'new' : 'existing',
    rows: v.rows as ResolvedComponent[],
    bundleNameInput: typeof v.bundleNameInput === 'string' ? v.bundleNameInput : '',
    manualPrices:
      typeof v.manualPrices === 'object' && v.manualPrices !== null
        ? (v.manualPrices as Record<string, number | null>)
        : undefined,
    retailOverride: typeof v.retailOverride === 'number' ? v.retailOverride : undefined,
    chPromotions:
      typeof v.chPromotions === 'object' && v.chPromotions !== null
        ? (v.chPromotions as Record<string, PromotionValue>)
        : undefined,
    summary: (v.summary as PricingSimSummary) ?? defaultSummary(),
  }
}

function parseV2(o: Record<string, unknown>): PricingSimSnapshot | null {
  if (typeof o.live !== 'object' || o.live === null) return null
  if (!Array.isArray(o.selectedChannelIds)) return null
  if (typeof o.chOverrides !== 'object' || o.chOverrides === null) return null
  if (!Array.isArray(o.variants)) return null

  const variants = o.variants.map(parseVariant).filter((v): v is PricingVariant => v !== null)
  if (variants.length === 0) return null

  const activeVariantId =
    typeof o.activeVariantId === 'string' && variants.some((v) => v.id === o.activeVariantId)
      ? o.activeVariantId
      : variants[0].id

  return {
    v: 2,
    live: o.live as SnapLiveSim,
    selectedChannelIds: o.selectedChannelIds as string[],
    chOverrides: o.chOverrides as Record<string, SnapChOverride>,
    snap: o.snap !== false,
    activeVariantId,
    variants,
    summary:
      (o.summary as PricingSimSummary) ??
      buildRepresentativeSummary(variants, {
        channelCount: (o.selectedChannelIds as string[]).length,
        targetMarginPct: variants[0].summary.targetMarginPct,
      }),
  }
}

/**
 * localStorage/DB에서 읽은 임의 JSON을 방어적으로 PricingSimSnapshot(v2)으로 파싱한다.
 * v1은 탭 1개 v2로 변환해 반환. 형태가 어긋나면 null (조용히 버림 — 복원 실패는 치명적이지 않다).
 */
export function parseSnapshot(raw: unknown): PricingSimSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.v === 2) return parseV2(o)
  if (o.v === 1) {
    const v1 = parseV1(o)
    return v1 ? v1ToV2(v1) : null
  }
  return null
}

/** 스냅샷이 "의미있는" 내용을 담고 있는지 (임시저장 가치 판단) */
export function isMeaningfulSnapshot(s: PricingSimSnapshot): boolean {
  return s.variants.some((v) => v.rows.length > 0) || s.selectedChannelIds.length > 0
}

/**
 * 탭 간 대표 요약 산출 — 목록/히스토리 패널은 탭 구조를 모르므로 이 값으로 하위호환.
 * productNames=전 탭 합집합(순서 유지), price/salePrice/discount는 탭 간 min/max,
 * totalCost=첫 탭 값, retail=전 탭 동일하면 그 값 아니면 첫 탭, mode=전 탭 동일하면 그 값 혼재면 'existing'.
 */
export function buildRepresentativeSummary(
  variants: PricingVariant[],
  common: { channelCount: number; targetMarginPct: number }
): PricingSimSummary {
  const productNames: string[] = []
  for (const v of variants) {
    for (const name of v.summary.productNames) {
      if (!productNames.includes(name)) productNames.push(name)
    }
  }

  const minOf = (pick: (s: PricingSimSummary) => number | null | undefined): number | null => {
    const vals = variants.map((v) => pick(v.summary)).filter((n): n is number => n != null)
    return vals.length > 0 ? Math.min(...vals) : null
  }
  const maxOf = (pick: (s: PricingSimSummary) => number | null | undefined): number | null => {
    const vals = variants.map((v) => pick(v.summary)).filter((n): n is number => n != null)
    return vals.length > 0 ? Math.max(...vals) : null
  }

  const first = variants[0].summary
  const retailVals = variants.map((v) => v.summary.retail)
  const retail = retailVals.every((r) => r === retailVals[0]) ? retailVals[0] : first.retail
  const modes = new Set(variants.map((v) => v.mode))

  return {
    productNames,
    channelCount: common.channelCount,
    targetMarginPct: common.targetMarginPct,
    priceMin: minOf((s) => s.priceMin),
    priceMax: maxOf((s) => s.priceMax),
    totalCost: first.totalCost,
    mode: modes.size === 1 ? variants[0].mode : 'existing',
    retail,
    salePriceMin: minOf((s) => s.salePriceMin),
    salePriceMax: maxOf((s) => s.salePriceMax),
    discountMin: minOf((s) => s.discountMin),
    discountMax: maxOf((s) => s.discountMax),
  }
}
