// 상품 단위 생산차수 가중평균 원가 로더 — 상품 상세와 공헌이익의 단일 소스.

import { prisma } from '@/lib/prisma'
import {
  calculateProductUnitCosts,
  type ProductUnitCostBreakdown,
} from '@/lib/sh/production-cost-allocation'

export async function loadProductionCostBreakdowns(
  spaceId: string,
  productIds: string[]
): Promise<Map<string, ProductUnitCostBreakdown>> {
  if (productIds.length === 0) return new Map()

  const runs = await prisma.productionRun.findMany({
    where: {
      spaceId,
      status: 'STOCKED_IN',
      items: { some: { option: { productId: { in: productIds } } } },
    },
    select: {
      id: true,
      totalCost: true,
      items: {
        select: {
          quantity: true,
          stockedInQty: true,
          option: { select: { productId: true } },
        },
      },
      costs: {
        select: {
          amount: true,
          vatIncluded: true,
          category: true,
          targetProductId: true,
        },
      },
    },
  })

  const requested = new Set(productIds)
  return new Map(
    [
      ...calculateProductUnitCosts(
        runs.map((run) => ({
          id: run.id,
          totalCost: run.totalCost == null ? null : Number(run.totalCost),
          items: run.items.map((item) => ({
            productId: item.option.productId,
            quantity: item.quantity,
            stockedInQty: item.stockedInQty,
          })),
          costs: run.costs.map((cost) => ({
            amount: Number(cost.amount),
            vatIncluded: cost.vatIncluded,
            category: cost.category,
            targetProductId: cost.targetProductId,
          })),
        }))
      ),
    ].filter(([productId]) => requested.has(productId))
  )
}

export async function loadProductionUnitCosts(
  spaceId: string,
  productIds: string[]
): Promise<Map<string, number>> {
  const breakdowns = await loadProductionCostBreakdowns(spaceId, productIds)
  return new Map(
    [...breakdowns].map(([productId, breakdown]) => [productId, breakdown.totalUnitCost])
  )
}
