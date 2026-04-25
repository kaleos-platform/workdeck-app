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

export function calculatePricing(inputs: PricingInputs): PricingResult {
  const {
    costPrice,
    salePrice,
    discountRate,
    channelFeePct,
    shippingCost,
    packagingCost,
    adCostPct,
    operatingCostPct,
    includeVat,
    vatRate,
  } = inputs

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
