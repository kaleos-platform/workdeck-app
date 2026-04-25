// 가격 시뮬레이션 계산 라이브러리

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

  // 할인 후 최종 판매가
  const finalPrice = Number((salePrice * (1 - discountRate)).toFixed(2))

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
