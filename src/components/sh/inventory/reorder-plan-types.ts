// 발주 계획 공유 타입 — 번스타인 API 계약과 동기화 유지

export type ReorderPlanStatus = 'DRAFT' | 'FINALIZED' | 'CONSUMED'

export type ForecastModel = 'SMA' | 'WMA' | 'HW' | 'CROSTON' | 'BAYES' | 'MANUAL'

export type ReorderPlan = {
  id: string
  planNo: string
  productName: string | null // 상품 단위 계획명. null = 레거시 전체-계획
  status: ReorderPlanStatus
  windowDays: number
  finalizedAt: string | null
  biasAdjustApplied: Record<string, number> | null
  totalSuggestedQty: number
  totalFinalQty: number
  memo: string | null
  createdAt: string
}

export type ReorderPlanItem = {
  id: string
  planId: string
  optionId: string
  productId: string
  currentStock: number
  dailyAvgForecast: number
  forecastModel: ForecastModel
  leadTimeDays: number
  safetyStockQty: number
  suggestedQty: number
  roundedSuggestedQty: number
  finalQty: number
  roundUnit: number
  rationale: string | null
  userNote: string | null
  biasAdjustFactor: number
  confidenceScore: number | null
  // JSON 스냅샷 — 구조는 번스타인이 확정 예정
  inputsSnapshot: {
    profile?: 'FAST' | 'INTERMITTENT' | 'COLD_START'
    // 콜드스타트 보정 입력값 (cold-start-interview API가 기록 — 설정값/출력 구분)
    coldStartInterview?: {
      targetDailySales: number
      seasonFactor: number
    }
    // TODO: 번스타인 응답 형식 확인
    [key: string]: unknown
  } | null
}

export type ProductInfo = {
  productId: string
  productName: string
  productCode: string | null
  brandName: string | null
  options: Array<{
    optionId: string
    optionName: string
    sku: string | null
    optionDeleted?: boolean
  }>
}

// GET /api/sh/inventory/reorder/plan/[id] 응답
export type PlanDetailResponse = {
  plan: ReorderPlan
  items: ReorderPlanItem[]
  productInfo: ProductInfo[]
}

export type ReorderPlanAccuracy = {
  planId: string
  optionId: string
  evaluatedAt: string
  periodStart: string
  periodEnd: string
  actualOutbound: number
  forecastOutbound: number
  wape: number
  bias: number
  stockoutDays: number
  overstockDays: number
}

// 목록 페이지용 plan 요약
export type ReorderPlanSummary = {
  id: string
  planNo: string
  productName: string | null // 상품 단위 계획명. null = 레거시 전체-계획
  status: ReorderPlanStatus
  createdAt: string
  finalizedAt: string | null
  totalSuggestedQty: number
  totalFinalQty: number
}
