type TargetedCost = {
  category: string
  targetProductId?: string | null
}

export function validateProductionCostTargets(
  costs: TargetedCost[],
  productIds: ReadonlySet<string>
): string | null {
  for (const cost of costs) {
    if (cost.category !== 'MARKETING') continue
    if (!cost.targetProductId) return '마케팅 비용의 대상 상품을 선택하세요'
    if (!productIds.has(cost.targetProductId)) {
      return '마케팅 비용의 대상 상품이 생산 차수에 포함되어 있지 않습니다'
    }
  }

  return null
}
