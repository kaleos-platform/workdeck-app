// 계획(PLANNED)·발주(ORDERED) 차수 모두 입고 예정으로 센다(발주 v2 결정).
export const INCOMING_PRODUCTION_STATUSES = ['PLANNED', 'ORDERED'] as const

export type ProductionRunForIncomingStock = {
  status: string
  items: Array<{
    optionId: string
    quantity: number
  }>
}

export function sumIncomingProductionQtyByOption(
  runs: ProductionRunForIncomingStock[]
): Map<string, number> {
  const incomingByOption = new Map<string, number>()

  for (const run of runs) {
    if (!(INCOMING_PRODUCTION_STATUSES as readonly string[]).includes(run.status)) continue
    for (const item of run.items) {
      incomingByOption.set(
        item.optionId,
        (incomingByOption.get(item.optionId) ?? 0) + item.quantity
      )
    }
  }

  return incomingByOption
}

export function plannedStockQty(input: { onHandQty: number; incomingQty: number }): number {
  return input.onHandQty + input.incomingQty
}
