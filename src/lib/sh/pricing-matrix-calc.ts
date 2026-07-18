// 가격 시뮬레이션 매트릭스 계산 라이브러리
// 옵션 × 채널 조합당 11개 할인율 셀을 순수 함수로 계산한다.

import { classifyTier, type Tier, type TierThresholds } from './margin-tier'
import { lookupCategoryFeePct, type FeeRateInput } from './channel-fee-lookup'

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
  /** 카테고리별 수수료율 배열 — 항상 '기본' 1건 이상 포함 */
  feeRates: FeeRateInput[]
  paymentFeeIncluded: boolean
  paymentFeePct: number // 0~1 (paymentFeeIncluded=false 일 때 사용)
  applyAdCost: boolean
  /** 배송비 산정 방식: 'FIXED'=정액(shippingFee 원), 'PERCENT'=판매가 대비 비율(shippingFeePct). 미지정 시 FIXED */
  shippingFeeType?: 'FIXED' | 'PERCENT'
  shippingFee: number // 원 (FIXED)
  shippingFeePct?: number // 0~1 (PERCENT, 판매가 대비)
  freeShippingThreshold: number | null // 원, null 또는 0이면 무료배송 기준 없음 (항상 유료). PERCENT 모드에선 무시(항상 부과)
}

/** 번들 구성 컴포넌트 (단일 SKU 원가·소비자가 기준가 기여) */
export type BundleComponent = {
  costPrice: number // 원 (won)
  retailPrice: number // 원 — 컴포넌트 소비자가 기준가 기여분
  quantity: number // 번들 내 이 컴포넌트 수량
}

/**
 * 번들 입력 — 단일 옵션 또는 복수 컴포넌트 묶음을 표현한다.
 *
 * - components: 원가 계산 기준. Σ(costPrice × quantity)
 * - salePrice: 번들의 실제 판매가 (할인 기준가). 컴포넌트 소비자가 합계와 무관하게 독립 설정.
 * - packagingCost: 번들당 1회 적용 포장비
 */
export type MatrixBundle = {
  components: BundleComponent[]
  packagingCost: number // 포장비 (원, 번들당 1회 적용)
  salePrice: number // 1번들 판매가 (원) — 할인율 기준가
}

/**
 * 하위 호환 단일 옵션 입력 (레거시).
 * 내부적으로 optionToBundle()로 번들로 변환한 후 사용한다.
 */
export type MatrixOption = {
  optionId?: string | null
  name?: string
  retailPrice: number // 1세트 가격 (원)
  costPrice: number // 공급가 (원)
  unitsPerSet: number // 1세트 = N개
  packagingCost: number // 포장비 (원)
}

/** MatrixOption → MatrixBundle 어댑터 */
export function optionToBundle(option: MatrixOption): MatrixBundle {
  return {
    components: [
      {
        costPrice: option.costPrice,
        retailPrice: option.retailPrice,
        quantity: Math.max(1, Math.round(option.unitsPerSet)),
      },
    ],
    packagingCost: option.packagingCost,
    salePrice: option.retailPrice,
  }
}

/** 프로모션 입력 */
export type MatrixPromotion = {
  type: 'NONE' | 'FLAT' | 'PERCENT' | 'COUPON' | 'MIN_PRICE'
  value: number // PERCENT: 0~1, FLAT/COUPON: 원, MIN_PRICE: 최소 판매가 ceiling (원)
  /**
   * 최소 금액 조건 (원, FLAT/PERCENT 전용, 선택).
   * 컬럼 할인 적용 후 가격(p)이 이 값 이상일 때만 프로모션 차감 적용.
   * 0/undefined면 무조건 적용(현행). 예: "5만원 이상 2,000원 할인" → minThreshold=50000.
   */
  minThreshold?: number
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

/** 매트릭스 계산 입력 (번들 기반) */
export type MatrixInputs = {
  bundle: MatrixBundle
  channel: MatrixChannel
  promotion: MatrixPromotion
  globals: MatrixGlobals
  thresholds: TierThresholds
}

/** 단일 셀 계산 결과 */
export type MatrixCell = {
  discountRate: number // 0~1
  finalPrice: number // 최종 판매가 (프로모션 적용 후, 원)
  revenue: number // 유효 매출 (= 공급가 = finalPrice / (1+VAT), 마진 분모)
  cogs: number // 번들 원가 Σ(costPrice × quantity) (원)
  vat: number // 부가세 (= finalPrice − 공급가, includeVat=false 이면 0)
  fee: number // 채널수수료 + 결제수수료 합산 (원)
  channelFee: number // 채널 수수료 (원, 판매가 기준)
  paymentFee: number // 결제 수수료 (원, paymentFeeIncluded=true 이면 0)
  adCost: number // 광고비 (원, 판매가 기준)
  shipping: number // 배송비 (원, 무료배송 조건 충족 시 0)
  packaging: number // 포장비 (원)
  operating: number // 운영비 (원) — 신 모델에서 미사용(항상 0)
  returnCost: number // 반품 처리비 (원, applyReturnAdjustment=false 이면 0)
  totalCost: number // 원가 + 모든 비용 합산 (원)
  netProfit: number // 순이익 (원, 1번들 기준)
  margin: number // 순이익율 (0~1, 공급가 분모)
  perUnitProfit: number // 1개당 순이익 (원)
  tier: Tier // 마진 등급
}

/** 추천 소매가 3단계 결과 */
export type RecommendedRetail = {
  good: number | null // platformTargetGood 달성 추천가
  fair: number | null // platformTargetFair 달성 추천가
  min: number | null // minimumAcceptableMargin 달성 추천가
}

/** 옵션×채널 매트릭스 (20컬럼, 0%~95%) */
export type Matrix = {
  cells: MatrixCell[] // DISCOUNT_COLUMNS 순서, 길이 20
  /** 최소 허용 마진 유지 가능한 최대 할인율 (없으면 null) */
  maxDiscountForMinMargin: number | null
  /** 추천 소매가 3단계 (good/fair/min). 역산 불가시 각각 null */
  recommendedRetail: RecommendedRetail
  /**
   * 'good' 등급 달성을 위한 추천 소매가 역산 (하위 호환 alias = recommendedRetail.good)
   * @deprecated recommendedRetail.good 사용 권장
   */
  recommendedRetailForGoodMargin: number | null
  /**
   * good 추천가로 현재 프로모션 적용 시 목표 마진 달성 가능 여부.
   * recommendedRetail.good 가 null 이면 false.
   */
  targetAchievableUnderPromotion: boolean
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

/** 번들 총 원가: Σ(component.costPrice × quantity) */
function bundleSetCost(bundle: MatrixBundle): number {
  return r2(
    bundle.components.reduce(
      (sum, c) => sum + n(c.costPrice) * Math.max(1, Math.round(n(c.quantity))),
      0
    )
  )
}

/** 번들 총 개수: Σ quantity (perUnitProfit 기준) */
function bundleTotalUnits(bundle: MatrixBundle): number {
  return Math.max(
    1,
    bundle.components.reduce((sum, c) => sum + Math.max(1, Math.round(n(c.quantity))), 0)
  )
}

// ─── 계산 함수 ─────────────────────────────────────────────────────────────────

/** 단일 셀 계산 */
function calcCell(discountRate: number, inputs: MatrixInputs): MatrixCell {
  const { bundle, channel, promotion, globals, thresholds } = inputs

  // 1. 컬럼 할인 적용 (번들 판매가 기준)
  let p = n(bundle.salePrice) * (1 - discountRate)

  // 2. 시나리오 프로모션 누적 적용 (컬럼 할인 → 프로모션 순서)
  //    FLAT/PERCENT는 최소 금액 조건(minThreshold) 충족 시에만 차감 (조건부 할인).
  //    조건 비교 기준 = 컬럼 할인 적용 후 가격 p. 미설정/0이면 무조건 적용.
  const minThreshold = n(promotion.minThreshold)
  const conditionMet = minThreshold <= 0 || p >= minThreshold
  if (promotion.type === 'PERCENT') {
    if (conditionMet) p = p * (1 - n(promotion.value))
  } else if (promotion.type === 'FLAT') {
    if (conditionMet) p = p - n(promotion.value)
  } else if (promotion.type === 'COUPON') {
    p = p - n(promotion.value)
  } else if (promotion.type === 'MIN_PRICE') {
    // 최소 판매가 ceiling — column 할인 결과가 promotion.value보다 높으면 강제 인하
    p = Math.min(p, n(promotion.value))
  }
  const finalPrice = Math.max(0, r2(p))

  // 3. VAT 처리 — 공급가(VAT 제외) = 마진 분모. vat = 판매가 − 공급가.
  const nominalRevenue = globals.includeVat ? r2(finalPrice / (1 + n(globals.vatRate))) : finalPrice
  const vat = r2(finalPrice - nominalRevenue)

  // 4. 채널 수수료 — 판매가(gross) 기준. categoryName fallback '기본'.
  //    쿠팡 등 마켓 수수료는 결제금액(판매가) 기준 부과 → finalPrice × 수수료율.
  const channelFee = r2(finalPrice * lookupCategoryFeePct(channel.feeRates))

  // 5. 결제 수수료 (PG) — 판매가 기준. paymentFeeIncluded=true 이면 채널 수수료에 포함.
  const paymentFee = channel.paymentFeeIncluded ? 0 : r2(finalPrice * n(channel.paymentFeePct))

  // 6. 광고비 (채널 설정이 결정) — 판매가 기준
  const adCost = channel.applyAdCost ? r2(finalPrice * n(globals.adCostPct)) : 0

  // 7. 운영비 — 신 모델에서 미사용 (스크린샷 시안에 항목 없음)
  const operating = 0

  // 8. 포장비 (번들당 1회)
  const packaging = r2(n(bundle.packagingCost))

  // 9. 배송비
  //    PERCENT: 판매가(finalPrice) 대비 비율로 항상 부과.
  //    FIXED: 무료배송 임계값 도달 시 판매자가 배송비 부담(finalPrice >= threshold → shippingFee, 아니면 0).
  let shipping = 0
  if (channel.shippingFeeType === 'PERCENT') {
    shipping = r2(finalPrice * n(channel.shippingFeePct))
  } else {
    const threshold = channel.freeShippingThreshold
    shipping =
      threshold != null && threshold > 0 && finalPrice >= threshold ? r2(n(channel.shippingFee)) : 0
  }

  // 10. 번들 원가: Σ(component.costPrice × quantity)
  const setCost = bundleSetCost(bundle)

  // 11. 반품 — 처리비만 비용 반영(매출 차감 없음). returnCost = 처리비 × 반품율.
  const returnCost =
    globals.applyReturnAdjustment && globals.expectedReturnRate > 0
      ? r2(n(globals.returnHandlingCost) * n(globals.expectedReturnRate))
      : 0

  // 12. 합산 — 마진 분모 = 공급가(nominalRevenue)
  const effectiveRevenue = nominalRevenue
  const fee = r2(channelFee + paymentFee)
  const totalCost = r2(
    setCost + channelFee + paymentFee + adCost + operating + packaging + shipping + returnCost
  )
  const netProfit = r2(effectiveRevenue - totalCost)
  const margin = effectiveRevenue > 0 ? r4(netProfit / effectiveRevenue) : 0
  const totalUnits = bundleTotalUnits(bundle)
  const tier = classifyTier(margin, thresholds)

  return {
    discountRate,
    finalPrice,
    revenue: effectiveRevenue,
    cogs: setCost,
    vat,
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
    perUnitProfit: r2(netProfit / totalUnits),
    tier,
  }
}

/**
 * 목표 마진 달성을 위한 추천 판매가 역산 (0% 할인, 프로모션 없음 기준).
 *
 * gross-basis 모델 — 수수료/광고/PG는 판매가(P) 기준, 마진 분모는 공급가(P/(1+v)).
 *   margin = (공급가 − totalCost) / 공급가 = target
 *   공급가 = P / (1 + v)   [includeVat=true, 아니면 v=0]
 *   totalCost = cogs + P·Σfee% + packaging + shipping + returnCost
 *   Σfee% = 채널수수료율 + PG율(미포함시) + 광고비율(적용시)
 *   ⇒ P·(1−target)/(1+v) − P·Σfee% = cogs + packaging + shipping + returnCost
 *   ⇒ P = fixedCosts / [ (1−target)/(1+v) − Σfee% ]
 *
 * 무료배송 임계값 step function 처리:
 *   - threshold null/0: 배송비 비용 = 0 (calcCell과 동일)
 *   - threshold > 0: 두 가지 시나리오(배송비 포함/미포함)를 각각 역산 후
 *     결과 판매가가 자신의 가정과 일치하는 브랜치를 선택.
 *     둘 다 일치하면(임계값 사이) 보수적 고가 선택.
 *
 * 분모 <= 0 이면 null 반환 (구조적 달성 불가).
 */
function calcRetailForTarget(target: number, inputs: MatrixInputs): number | null {
  try {
    const { bundle, channel, globals } = inputs

    const isPercentShipping = channel.shippingFeeType === 'PERCENT'

    let feePct = lookupCategoryFeePct(channel.feeRates)
    if (!channel.paymentFeeIncluded) feePct += n(channel.paymentFeePct)
    if (channel.applyAdCost) feePct += n(globals.adCostPct)
    // PERCENT 배송비는 판매가 비례 → 분모항(Σfee%)에 포함
    if (isPercentShipping) feePct += n(channel.shippingFeePct)

    // gross-basis 분모: (1−target)/(1+v) − Σfee%
    const vatDivisor = globals.includeVat ? 1 + n(globals.vatRate) : 1
    const denominator = (1 - target) / vatDivisor - feePct
    if (denominator <= 0) return null

    const setCost = bundleSetCost(bundle)
    const returnCostFixed =
      globals.applyReturnAdjustment && globals.expectedReturnRate > 0
        ? r2(n(globals.returnHandlingCost) * n(globals.expectedReturnRate))
        : 0
    const packagingCost = n(bundle.packagingCost)

    // 판매가(P) = fixedCosts / denominator
    const priceFor = (fixed: number): number | null => {
      const p = fixed / denominator
      return p > 0 && Number.isFinite(p) ? r2(p) : null
    }

    // PERCENT 배송비는 고정비 없음(분모에 반영됨)
    if (isPercentShipping) {
      return priceFor(setCost + packagingCost + returnCostFixed)
    }

    const threshold = channel.freeShippingThreshold

    // threshold null/0: 판매자 배송비 부담 없음 (고객 부담 or 무관)
    if (threshold == null || threshold <= 0) {
      return priceFor(setCost + packagingCost + returnCostFixed)
    }

    // threshold > 0: 두 브랜치 계산
    const shippingFee = r2(n(channel.shippingFee))
    // 브랜치 A: 판매자 배송비 포함 (finalPrice >= threshold 가정)
    const retailA = priceFor(setCost + packagingCost + shippingFee + returnCostFixed)
    // 브랜치 B: 판매자 배송비 없음 (finalPrice < threshold 가정)
    const retailB = priceFor(setCost + packagingCost + returnCostFixed)

    const aConsistent = retailA != null && retailA >= threshold
    const bConsistent = retailB != null && retailB < threshold

    if (aConsistent && !bConsistent) return retailA
    if (bConsistent && !aConsistent) return retailB
    // 둘 다 일치(임계값 사이) 또는 둘 다 불일치 → 보수적 고가 선택
    if (retailA != null && retailB != null) return Math.max(retailA, retailB)
    return retailA ?? retailB
  } catch {
    return null
  }
}

/**
 * 세 가지 목표 마진(good/fair/min)에 대해 추천 소매가를 역산한다.
 */
function calcRecommendedRetail(inputs: MatrixInputs): RecommendedRetail {
  const { thresholds, globals } = inputs
  return {
    good: calcRetailForTarget(thresholds.platformTargetGood, inputs),
    fair: calcRetailForTarget(thresholds.platformTargetFair, inputs),
    min: calcRetailForTarget(globals.minimumAcceptableMargin, inputs),
  }
}

/**
 * good 추천가로 현재 프로모션 적용 시 목표 마진(good) 달성 여부를 검사한다.
 * 추천가가 null이면 false.
 */
function calcTargetAchievable(recommendedGood: number | null, inputs: MatrixInputs): boolean {
  if (recommendedGood == null) return false
  const EPSILON = 0.005
  // good 추천가로 bundle.salePrice를 오버라이드한 번들 생성
  const testBundle: MatrixBundle = { ...inputs.bundle, salePrice: recommendedGood }
  const testInputs: MatrixInputs = { ...inputs, bundle: testBundle }
  const cell = calcCell(0, testInputs) // 0% 할인, 프로모션은 inputs 그대로
  return cell.margin >= inputs.thresholds.platformTargetGood - EPSILON
}

// ─── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 번들 × 채널 조합에 대해 20개 할인율 컬럼의 매트릭스를 계산한다.
 *
 * - 순수 함수: 부작용 없음, DB 접근 없음
 * - inputs.bundle 로 번들을 전달. 단일 옵션은 optionToBundle()로 변환.
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

  const recommendedRetail = calcRecommendedRetail(inputs)
  const targetAchievableUnderPromotion = calcTargetAchievable(recommendedRetail.good, inputs)

  return {
    cells,
    maxDiscountForMinMargin,
    recommendedRetail,
    recommendedRetailForGoodMargin: recommendedRetail.good,
    targetAchievableUnderPromotion,
  }
}
