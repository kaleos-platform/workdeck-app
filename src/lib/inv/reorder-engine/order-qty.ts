// 발주량 공식

/**
 * 필요량을 발주 단위로 올린다. 필요량이 단위의 절반 미만이면 0 —
 * 저판매 옵션의 필요 1~2개가 단위(10)로 튀어 과발주되는 것을 막는다(에디 결정 2026-11-23).
 */
export function roundToOrderUnit(qty: number, roundUnit: number): number {
  const unit = Number.isFinite(roundUnit) && roundUnit > 0 ? Math.floor(roundUnit) : 1
  if (qty <= 0 || qty < unit / 2) return 0
  return Math.ceil(qty / unit) * unit
}

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
  return {
    gross,
    suggestedQty,
    roundedQty: roundToOrderUnit(suggestedQty, i.roundUnit),
    checkStock,
    coverDays: i.dailyRate > 0 ? (onHand + i.incomingQty - i.safetyStockQty) / i.dailyRate : null,
  }
}
