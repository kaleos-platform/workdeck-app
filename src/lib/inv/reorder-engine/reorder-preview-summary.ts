// 발주 미리보기(runReorderPlanRequest dryRun) 응답 → 에이전트(MCP)용 요약.
// 숫자는 발주 화면 위저드와 같은 계산에서 그대로 옮긴다 — 에이전트가 새 숫자를 만들지 않게
// 합계·소진일까지 여기서 만든다.

type PreviewOption = {
  optionId: string
  productId: string
  productName: string
  optionName: string
  sku: string | null
  finalQty: number
  rocketBaselineQty: number | null
  dailyAvgForecast: number
  onHandStock: number
  incomingQty: number
  leadTimeDays: number
  targetCoverDays: number
  recommendedModel: string
  selectedModel: string
  isNewOption: boolean
}

type Preview = {
  locationName: string | null
  options: PreviewOption[]
  ownLocations?: Array<{ id: string; name: string; isActive?: boolean }>
  linkedSkuAllocation?: {
    skus: Array<{ name: string; optionName: string | null; allocSets: number }>
  } | null
}

const MODEL_LABEL: Record<string, string> = {
  MA30: '이동평균 30일',
  MA90: '이동평균 90일',
  MA_BLEND: '혼합 이동평균',
  SES_TREND: '지수평활+추세',
  CROSTON: '간헐 수요',
  MANUAL: '수동(신상품)',
}

export function summarizeReorderPreview(p: Preview) {
  const head = p.options.find((o) => !o.isNewOption) ?? p.options[0]
  const options = p.options.map((o) => {
    const linkedQty = Math.min(o.finalQty, o.rocketBaselineQty ?? 0)
    const stockPlusIncoming = Math.max(0, o.onHandStock) + o.incomingQty
    return {
      optionId: o.optionId,
      optionName: o.optionName,
      sku: o.sku,
      orderQty: o.finalQty,
      linkedQty,
      ownQty: o.finalQty - linkedQty,
      dailyForecast: Math.round(o.dailyAvgForecast * 100) / 100,
      stockPlusIncoming,
      daysOfCoverWithIncoming:
        o.dailyAvgForecast > 0
          ? Math.round((stockPlusIncoming / o.dailyAvgForecast) * 10) / 10
          : null,
      isNewOption: o.isNewOption,
    }
  })
  const sum = (k: 'orderQty' | 'linkedQty' | 'ownQty') => options.reduce((s, o) => s + o[k], 0)
  return {
    productId: head?.productId ?? null,
    productName: head?.productName ?? null,
    selectedModel: head ? (MODEL_LABEL[head.selectedModel] ?? head.selectedModel) : null,
    recommendedModel: head ? (MODEL_LABEL[head.recommendedModel] ?? head.recommendedModel) : null,
    leadTimeDays: head?.leadTimeDays ?? null,
    targetCoverDays: head?.targetCoverDays ?? null,
    horizonDays: head ? head.leadTimeDays + head.targetCoverDays : null,
    linkedLocationName: p.locationName,
    ownLocationName: p.ownLocations?.find((l) => l.isActive !== false)?.name ?? null,
    totalOrderQty: sum('orderQty'),
    linkedTotalQty: sum('linkedQty'),
    ownTotalQty: sum('ownQty'),
    options: options.filter((o) => o.orderQty > 0),
    noOrderOptionCount: options.filter((o) => o.orderQty <= 0).length,
    linkedSkuAllocation: (p.linkedSkuAllocation?.skus ?? [])
      .filter((k) => k.allocSets > 0)
      .map((k) => ({ name: k.name, optionName: k.optionName, sets: k.allocSets })),
  }
}
