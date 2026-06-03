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
  confirmedAt: string | null // "예측 검증 시작" 시점 = 예측 동결점 = 평가 앵커
  supersededAt: string | null // revert로 대체된 시점
  supersededByPlanId: string | null // 대체한 새 계획
  sourcePlanId: string | null // 이 계획이 revert되어 파생된 원본
  biasAdjustApplied: Record<string, number> | null
  totalSuggestedQty: number
  totalFinalQty: number
  memo: string | null
  createdAt: string
}

// 발주 계획에 연결된 생산차수 요약 (재고 흐름 — 신뢰도와 무관)
export type ProductionRunSummary = {
  id: string
  runNo: string
  status: 'PLANNED' | 'ORDERED' | 'STOCKED_IN'
  brandId: string | null
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
  productionRuns?: ProductionRunSummary[]
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
