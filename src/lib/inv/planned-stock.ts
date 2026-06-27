export const INCOMING_PRODUCTION_STATUS = 'ORDERED' as const

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
    if (run.status !== INCOMING_PRODUCTION_STATUS) continue
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
