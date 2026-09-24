import { costExVat } from '@/lib/sh/cost'

export type ProductionCostRun = {
  id: string
  totalCost?: number | null
  items: Array<{ productId: string; quantity: number; stockedInQty: number | null }>
  costs: Array<{
    amount: number
    vatIncluded: boolean
    category: string
    targetProductId: string | null
  }>
}

export type ProductUnitCostBreakdown = {
  productionUnitCost: number
  marketingUnitCost: number
  totalUnitCost: number
  runCount: number
}

type ProductCostTotals = {
  quantity: number
  productionCost: number
  marketingCost: number
  runIds: Set<string>
}

export function calculateProductUnitCosts(
  runs: ProductionCostRun[]
): Map<string, ProductUnitCostBreakdown> {
  const totals = new Map<string, ProductCostTotals>()

  for (const run of runs) {
    const quantities = new Map<string, number>()
    for (const item of run.items) {
      const quantity = Math.max(0, item.stockedInQty ?? item.quantity)
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + quantity)
    }

    const runQuantity = [...quantities.values()].reduce((sum, quantity) => sum + quantity, 0)
    if (runQuantity <= 0) continue

    const productionCost =
      run.costs.length > 0
        ? run.costs
            .filter((cost) => cost.category !== 'MARKETING')
            .reduce((sum, cost) => sum + costExVat(cost.amount, cost.vatIncluded), 0)
        : Number(run.totalCost ?? 0)

    for (const [productId, quantity] of quantities) {
      if (quantity <= 0) continue

      const productTotals = totals.get(productId) ?? {
        quantity: 0,
        productionCost: 0,
        marketingCost: 0,
        runIds: new Set<string>(),
      }
      productTotals.quantity += quantity
      productTotals.productionCost += productionCost * (quantity / runQuantity)
      productTotals.marketingCost += run.costs
        .filter((cost) => cost.category === 'MARKETING' && cost.targetProductId === productId)
        .reduce((sum, cost) => sum + costExVat(cost.amount, cost.vatIncluded), 0)
      productTotals.runIds.add(run.id)
      totals.set(productId, productTotals)
    }
  }

  return new Map(
    [...totals].map(([productId, total]) => {
      const productionUnitCost = total.productionCost / total.quantity
      const marketingUnitCost = total.marketingCost / total.quantity
      return [
        productId,
        {
          productionUnitCost,
          marketingUnitCost,
          totalUnitCost: productionUnitCost + marketingUnitCost,
          runCount: total.runIds.size,
        },
      ]
    })
  )
}
