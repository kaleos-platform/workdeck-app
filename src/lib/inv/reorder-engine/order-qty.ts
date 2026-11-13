// 발주량 공식

export function computeOrderQty(i: {
  dailyRate: number
  leadTimeDays: number
  targetCoverDays: number
  safetyStockQty: number
  onHandQty: number
  incomingQty: number
  roundUnit: number
}): {
  gross: number
  suggestedQty: number
  roundedQty: number
  checkStock: boolean
  coverDays: number | null
} {
  const checkStock = i.onHandQty < 0
  const onHand = Math.max(i.onHandQty, 0)
  const gross = i.dailyRate * (i.leadTimeDays + i.targetCoverDays)
  const suggestedQty = Math.max(0, Math.ceil(gross + i.safetyStockQty - onHand - i.incomingQty))
  const unit = i.roundUnit > 0 ? i.roundUnit : 1
  return {
    gross,
    suggestedQty,
    roundedQty: Math.ceil(suggestedQty / unit) * unit,
    checkStock,
    coverDays: i.dailyRate > 0 ? (onHand + i.incomingQty - i.safetyStockQty) / i.dailyRate : null,
  }
}
