// 가격 시뮬레이션 계산 라이브러리

// ─── 프로모션 ─────────────────────────────────────────────────────────────────

/**
 * 시나리오 프로모션 입력 (서버 경로용).
 * - PERCENT: value는 0~1. DB/API 모두 0~1로 저장·전송
 *   (클라이언트가 UI값 0~100을 저장 전 /100 변환 — 레거시 pricing-sim-main 확인)
 * - FLAT / COUPON: value는 원(절대값)
 * - MIN_PRICE: value는 최소 판매가 상한(원)
 * - minThreshold: DB에 미저장(시나리오 레벨 컬럼 없음) — 서버 경로에서는 항상 undefined, 무조건 적용.
 */
export type PricingPromotion = {
  type: 'NONE' | 'FLAT' | 'PERCENT' | 'COUPON' | 'MIN_PRICE'
  /** PERCENT: 0~1 / FLAT·COUPON: 원 / MIN_PRICE: 원 */
  value: number
  minThreshold?: number
}

/**
 * 컬럼 할인 후 가격에 시나리오 프로모션을 누적 적용한다.
 * pricing-matrix-calc.ts calcCell 의 step 2 와 동일 로직.
 * 최종 반환값은 Math.max(0, ...) 클램프 적용.
 */
export function applyPromotionToPrice(priceAfterDiscount: number, promotion: PricingPromotion): number {
  let p = priceAfterDiscount
  const minThreshold = promotion.minThreshold ?? 0
  const conditionMet = minThreshold <= 0 || p >= minThreshold
  if (promotion.type === 'PERCENT') {
    if (conditionMet) p = p * (1 - promotion.value)
  } else if (promotion.type === 'FLAT') {
    if (conditionMet) p = p - promotion.value
  } else if (promotion.type === 'COUPON') {
    p = p - promotion.value
  } else if (promotion.type === 'MIN_PRICE') {
    p = Math.min(p, promotion.value)
  }
  return Math.max(0, Math.round(p * 100) / 100)
}

export type PricingInputs = {
  costPrice: number // 옵션 원가 (없으면 0)
  salePrice: number
  discountRate: number // 0~1
  channelFeePct: number // 0~1
  shippingCost: number
  packagingCost: number
  adCostPct: number // 0~1
  operatingCostPct: number // 0~1
  includeVat: boolean
  vatRate: number // 0.1 = 10%
  /**
   * 시나리오 프로모션 (선택).
   * PERCENT.value는 0~1 (DB 저장값 0~100을 /100 변환 후 전달).
   * 미전달 시 프로모션 없음(=기존 동작 동일).
   */
  promotion?: PricingPromotion
}

export type PricingResult = {
  finalPrice: number // salePrice × (1 - discountRate)
  revenueExVat: number // includeVat ? finalPrice / (1 + vatRate) : finalPrice
  channelFee: number // revenueExVat × channelFeePct
  adCost: number // revenueExVat × adCostPct
  operatingCost: number // revenueExVat × operatingCostPct
  totalCost: number // costPrice + channelFee + shippingCost + packagingCost + adCost + operatingCost
  netProfit: number // revenueExVat - totalCost
  margin: number // netProfit / revenueExVat (revenueExVat 0이면 0)
}

// 안전한 숫자 변환 — string/null/undefined를 모두 0으로 처리하여 산술 연산 보호
function n(v: unknown): number {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export function calculatePricing(inputs: PricingInputs): PricingResult {
  // 모든 숫자 입력을 방어적으로 Number()로 변환
  const costPrice = n(inputs.costPrice)
  const salePrice = n(inputs.salePrice)
  const discountRate = n(inputs.discountRate)
  const channelFeePct = n(inputs.channelFeePct)
  const shippingCost = n(inputs.shippingCost)
  const packagingCost = n(inputs.packagingCost)
  const adCostPct = n(inputs.adCostPct)
  const operatingCostPct = n(inputs.operatingCostPct)
  const { includeVat } = inputs
  const vatRate = n(inputs.vatRate)

  // 컬럼 할인 후 가격
  const priceAfterDiscount = Number((salePrice * (1 - discountRate)).toFixed(2))

  // 시나리오 프로모션 누적 적용 (미전달 시 그대로 — 기존 동작 보장)
  const finalPrice = inputs.promotion && inputs.promotion.type !== 'NONE'
    ? applyPromotionToPrice(priceAfterDiscount, inputs.promotion)
    : priceAfterDiscount

  // VAT 제외 매출
  const revenueExVat = includeVat ? Number((finalPrice / (1 + vatRate)).toFixed(2)) : finalPrice

  // 비용 항목 — revenueExVat 기준 비율 계산
  const channelFee = Number((revenueExVat * channelFeePct).toFixed(2))
  const adCost = Number((revenueExVat * adCostPct).toFixed(2))
  const operatingCost = Number((revenueExVat * operatingCostPct).toFixed(2))

  // 총 비용 = 원가 + 채널수수료 + 배송비 + 포장비 + 광고비 + 운영비
  const totalCost = Number(
    (costPrice + channelFee + shippingCost + packagingCost + adCost + operatingCost).toFixed(2)
  )

  // 순이익 = VAT 제외 매출 - 총 비용
  const netProfit = Number((revenueExVat - totalCost).toFixed(2))

  // 마진율 — revenueExVat가 0이면 0으로 처리 (div-by-zero 방지)
  const margin = revenueExVat === 0 ? 0 : Number((netProfit / revenueExVat).toFixed(4))

  return {
    finalPrice,
    revenueExVat,
    channelFee,
    adCost,
    operatingCost,
    totalCost,
    netProfit,
    margin,
  }
}
