// 가격 시뮬레이션 매트릭스 계산 라이브러리
// 옵션 × 채널 조합당 11개 할인율 셀을 순수 함수로 계산한다.

import { classifyTier, type Tier, type TierThresholds } from './margin-tier'

// ─── 상수 ──────────────────────────────────────────────────────────────────────

export const DISCOUNT_COLUMNS = [
  0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85,
  0.9, 0.95,
] as const
export type DiscountRate = (typeof DISCOUNT_COLUMNS)[number]

// ─── 타입 ──────────────────────────────────────────────────────────────────────

/** 채널 입력 (DB 채널 또는 인라인 채널 공통) */
export type MatrixChannel = {
  id?: string
  name?: string
  channelType: string | null // 'SELF_MALL' | 'OPEN_MARKET' | ... | null
  defaultFeePct: number // 0~1
  paymentFeeIncluded: boolean
  paymentFeePct: number // 0~1 (paymentFeeIncluded=false 일 때 사용)
  applyAdCost: boolean
  shippingFee: number // 원
  freeShippingThreshold: number | null // 원, null 또는 0이면 무료배송 기준 없음 (항상 유료)
}

/** 옵션 입력 */
export type MatrixOption = {
  optionId?: string | null
  name?: string
  retailPrice: number // 1세트 가격 (원)
  costPrice: number // 공급가 (원)
  unitsPerSet: number // 1세트 = N개
  packagingCost: number // 포장비 (원)
}

/** 프로모션 입력 */
export type MatrixPromotion = {
  type: 'NONE' | 'FLAT' | 'PERCENT' | 'COUPON' | 'MIN_PRICE'
  value: number // PERCENT: 0~1, FLAT/COUPON: 원, MIN_PRICE: 최소 판매가 ceiling (원)
}

/** 글로벌 시나리오 설정 */
export type MatrixGlobals = {
  includeVat: boolean
  vatRate: number // 0~1
  adCostPct: number // 0~1
  operatingCostPct: number // 0~1
  applyReturnAdjustment: boolean
  expectedReturnRate: number // 0~1
  returnHandlingCost: number // 원/건
  minimumAcceptableMargin: number // 0~1 (maxDiscountForMinMargin 계산 기준)
}

/** 매트릭스 계산 입력 */
export type MatrixInputs = {
  option: MatrixOption
  channel: MatrixChannel
  promotion: MatrixPromotion
  globals: MatrixGlobals
  thresholds: TierThresholds
}

/** 단일 셀 계산 결과 */
export type MatrixCell = {
  discountRate: number // 0~1
  finalPrice: number // 최종 판매가 (프로모션 적용 후, 원)
  revenue: number // 유효 매출 (반품 반영, VAT 제외, 원)
  fee: number // 채널수수료 + 결제수수료 합산 (원)
  channelFee: number // 채널 수수료 (원)
  paymentFee: number // 결제 수수료 (원, paymentFeeIncluded=true 이면 0)
  adCost: number // 광고비 (원)
  shipping: number // 배송비 (원, 무료배송 조건 충족 시 0)
  packaging: number // 포장비 (원)
  operating: number // 운영비 (원)
  returnCost: number // 반품 처리비 (원, applyReturnAdjustment=false 이면 0)
  totalCost: number // 원가 + 모든 비용 합산 (원)
  netProfit: number // 순이익 (원, 1세트 기준)
  margin: number // 순이익율 (0~1)
  perUnitProfit: number // 1개당 순이익 (원)
  tier: Tier // 마진 등급
}

/** 옵션×채널 매트릭스 (20컬럼, 0%~95%) */
export type Matrix = {
  cells: MatrixCell[] // DISCOUNT_COLUMNS 순서, 길이 20
  /** 최소 허용 마진 유지 가능한 최대 할인율 (없으면 null) */
  maxDiscountForMinMargin: number | null
  /** 'good' 등급 달성을 위한 추천 소매가 역산 (역산 불가시 null) */
  recommendedRetailForGoodMargin: number | null
}

// ─── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

// 안전한 숫자 변환 — NaN/Infinity를 0으로
function n(v: unknown): number {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

// 소수점 2자리 반올림
function r2(v: number): number {
  return Math.round(v * 100) / 100
}

// 소수점 4자리 반올림
function r4(v: number): number {
  return Math.round(v * 10000) / 10000
}

// ─── 계산 함수 ─────────────────────────────────────────────────────────────────

/** 단일 셀 계산 */
function calcCell(discountRate: number, inputs: MatrixInputs): MatrixCell {
  const { option, channel, promotion, globals, thresholds } = inputs

  // 1. 컬럼 할인 적용 (1세트 가격 기준)
  let p = n(option.retailPrice) * (1 - discountRate)

  // 2. 시나리오 프로모션 누적 적용 (컬럼 할인 → 프로모션 순서)
  if (promotion.type === 'PERCENT') {
    p = p * (1 - n(promotion.value))
  } else if (promotion.type === 'FLAT' || promotion.type === 'COUPON') {
    p = p - n(promotion.value)
  } else if (promotion.type === 'MIN_PRICE') {
    // 최소 판매가 ceiling — column 할인 결과가 promotion.value보다 높으면 강제 인하
    p = Math.min(p, n(promotion.value))
  }
  const finalPrice = Math.max(0, r2(p))

  // 3. VAT 처리
  const nominalRevenue = globals.includeVat ? r2(finalPrice / (1 + n(globals.vatRate))) : finalPrice

  // 4. 채널 수수료
  const channelFee = r2(nominalRevenue * n(channel.defaultFeePct))

  // 5. 결제 수수료 (PG) — paymentFeeIncluded=true 이면 이미 채널 수수료에 포함
  const paymentFee = channel.paymentFeeIncluded ? 0 : r2(nominalRevenue * n(channel.paymentFeePct))

  // 6. 광고비 (채널 설정이 결정)
  const adCost = channel.applyAdCost ? r2(nominalRevenue * n(globals.adCostPct)) : 0

  // 7. 운영비
  const operating = r2(nominalRevenue * n(globals.operatingCostPct))

  // 8. 포장비 (1세트당)
  const packaging = r2(n(option.packagingCost))

  // 9. 배송비 — 무료배송 임계값 도달 시 판매자가 배송비를 부담(비용 반영)
  //    finalPrice >= threshold 이면 판매자 배송비 부담 = shippingFee
  //    threshold 미달(고객이 배송비 부담) 또는 threshold 미설정이면 판매자 비용 = 0
  const threshold = channel.freeShippingThreshold
  const shipping =
    threshold != null && threshold > 0 && finalPrice >= threshold ? r2(n(channel.shippingFee)) : 0

  // 10. 1세트당 원가
  const setCost = r2(n(option.costPrice) * Math.max(1, Math.round(n(option.unitsPerSet))))

  // 11. 반품 보정 (applyReturnAdjustment)
  let effectiveRevenue: number
  let returnCost: number
  if (globals.applyReturnAdjustment && globals.expectedReturnRate > 0) {
    effectiveRevenue = r2(nominalRevenue * (1 - n(globals.expectedReturnRate)))
    returnCost = r2(n(globals.returnHandlingCost) * n(globals.expectedReturnRate))
  } else {
    effectiveRevenue = nominalRevenue
    returnCost = 0
  }

  // 12. 합산
  const fee = r2(channelFee + paymentFee)
  const totalCost = r2(
    setCost + channelFee + paymentFee + adCost + operating + packaging + shipping + returnCost
  )
  const netProfit = r2(effectiveRevenue - totalCost)
  const margin = effectiveRevenue > 0 ? r4(netProfit / effectiveRevenue) : 0
  const unitsPerSet = Math.max(1, Math.round(n(option.unitsPerSet)))
  const tier = classifyTier(margin, thresholds)

  return {
    discountRate,
    finalPrice,
    revenue: effectiveRevenue,
    fee,
    channelFee,
    paymentFee,
    adCost,
    shipping,
    packaging,
    operating,
    returnCost,
    totalCost,
    netProfit,
    margin,
    perUnitProfit: r2(netProfit / unitsPerSet),
    tier,
  }
}

/**
 * 'good' 등급 달성을 위한 추천 소매가 역산 (0% 할인, 프로모션 없음, 무료배송 없음 기준 근사).
 *
 * 공식 (applyReturnAdjustment=false 근사):
 *   revenue = retailPrice / (1 + vatRate)  [includeVat=true]
 *   totalPctCost = channelFeePct + paymentFeePct(미포함시) + operatingCostPct + adCostPct(적용시)
 *   setCost = costPrice * unitsPerSet
 *   revenue * (1 - totalPctCost) - (setCost + packaging + shipping) = revenue * goodTarget
 *   → revenue = (setCost + packaging + shipping) / (1 - totalPctCost - goodTarget)
 *   → retailPrice = revenue * (1 + vatRate)
 *
 * 분모 <= 0 이면 null 반환 (구조적 달성 불가).
 * PR-4에서 수치 최적화로 정교화 예정.
 */
function calcRecommendedRetail(inputs: MatrixInputs): number | null {
  try {
    const { option, channel, globals, thresholds } = inputs
    const goodTarget = thresholds.platformTargetGood

    let totalPctCost = n(channel.defaultFeePct) + n(globals.operatingCostPct)
    if (!channel.paymentFeeIncluded) totalPctCost += n(channel.paymentFeePct)
    if (channel.applyAdCost) totalPctCost += n(globals.adCostPct)
    // 반품 보정 적용 시 유효 매출이 줄어드는 효과를 근사 반영
    if (globals.applyReturnAdjustment) {
      totalPctCost += n(globals.expectedReturnRate)
    }

    const denominator = 1 - totalPctCost - goodTarget
    if (denominator <= 0) return null

    const unitsPerSet = Math.max(1, Math.round(n(option.unitsPerSet)))
    const setCost = r2(n(option.costPrice) * unitsPerSet)
    const shipping = r2(n(channel.shippingFee))
    const returnCostFixed = globals.applyReturnAdjustment
      ? r2(n(globals.returnHandlingCost) * n(globals.expectedReturnRate))
      : 0

    const fixedCosts = setCost + n(option.packagingCost) + shipping + returnCostFixed
    const revenueNeeded = fixedCosts / denominator
    if (revenueNeeded <= 0 || !Number.isFinite(revenueNeeded)) return null

    const retailPrice = globals.includeVat
      ? r2(revenueNeeded * (1 + n(globals.vatRate)))
      : r2(revenueNeeded)

    return retailPrice > 0 ? retailPrice : null
  } catch {
    return null
  }
}

// ─── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 옵션 × 채널 조합에 대해 20개 할인율 컬럼의 매트릭스를 계산한다.
 *
 * - 순수 함수: 부작용 없음, DB 접근 없음
 */
export function calculateMatrix(inputs: MatrixInputs): Matrix {
  const cells = DISCOUNT_COLUMNS.map((d) => calcCell(d, inputs))

  // 최소 허용 마진 만족 구간에서 최대 할인율 탐색
  const minMargin = n(inputs.globals.minimumAcceptableMargin)
  let maxDiscountForMinMargin: number | null = null
  for (let i = DISCOUNT_COLUMNS.length - 1; i >= 0; i--) {
    if (cells[i].margin >= minMargin) {
      maxDiscountForMinMargin = DISCOUNT_COLUMNS[i]
      break
    }
  }

  const recommendedRetailForGoodMargin = calcRecommendedRetail(inputs)

  return { cells, maxDiscountForMinMargin, recommendedRetailForGoodMargin }
}
