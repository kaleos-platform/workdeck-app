// 발주 예측 계산기 (순수 함수)
//
// 공식:
//   dailyAvgOutbound = totalOutbound / windowDays
//   neededStock      = (dailyAvgOutbound * leadTimeDays) + safetyStockQty
//   reorderQty       = max(0, ceil(neededStock - currentStock))
//   estimatedDepletionDays = currentStock > 0 && dailyAvgOutbound > 0
//                            ? currentStock / dailyAvgOutbound
//                            : null
//   isUrgent = estimatedDepletionDays !== null && estimatedDepletionDays < 7

export type ReorderInput = {
  totalOutbound: number // 분석 기간 내 총 출고 수량
  windowDays: number
  leadTimeDays: number
  safetyStockQty: number
  currentStock: number // 음수 가능
}

export type ReorderOutput = {
  dailyAvgOutbound: number
  neededStock: number
  reorderQty: number
  estimatedDepletionDays: number | null
  isUrgent: boolean
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function calculateReorder(input: ReorderInput): ReorderOutput {
  const windowDays = input.windowDays > 0 ? input.windowDays : 1
  const rawDailyAvg = input.totalOutbound / windowDays
  const dailyAvgOutbound = round2(rawDailyAvg)

  // neededStock 은 정수로 반올림해 사용한다 (수량 단위)
  const neededStockRaw = rawDailyAvg * input.leadTimeDays + input.safetyStockQty
  const neededStock = Math.ceil(neededStockRaw)

  const diff = neededStockRaw - input.currentStock
  const reorderQty = diff > 0 ? Math.ceil(diff) : 0

  let estimatedDepletionDays: number | null = null
  if (input.currentStock > 0 && rawDailyAvg > 0) {
    estimatedDepletionDays = Math.round((input.currentStock / rawDailyAvg) * 10) / 10
  }

  const isUrgent =
    estimatedDepletionDays !== null && estimatedDepletionDays < 7

  return {
    dailyAvgOutbound,
    neededStock,
    reorderQty,
    estimatedDepletionDays,
    isUrgent,
  }
}
