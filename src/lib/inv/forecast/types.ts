// 발주 예측 엔진 공유 타입 정의

import type { ReorderForecastModel } from '@/generated/prisma/client'

// ─── 입력 타입 ─────────────────────────────────────────────────────────────────

/** 일별 출고 수량 (연속된 날짜로 zero-fill된 배열) */
export type DailyOutbound = {
  date: string // 'YYYY-MM-DD'
  qty: number // 해당일 출고 수량 (0 포함)
}

/** Bayesian prior (없으면 약한 prior 사용) */
export type BayesianPrior = {
  alpha0: number // shape (기대 수요)
  beta0: number // rate (역할: 1/scale)
}

/** forecastOption 호출 옵션 */
export type ForecastOptions = {
  prior?: BayesianPrior // Bayesian prior (COLD_START 또는 카테고리 집계)
  seasonalNaiveBlend?: number // seasonal-naive 블렌딩 비율 (0~1, 기본 0)
}

// ─── 출력 타입 ─────────────────────────────────────────────────────────────────

/** 예측 엔진 결과 */
export type ForecastResult = {
  dailyAvg: number // 예측 일평균 소진량
  model: ReorderForecastModel // 사용된 모델 enum
  confidence: number // 예측 신뢰도 (0~1)
  debug: Record<string, unknown> // 디버그 정보 (inputsSnapshot에 저장)
}

// ─── 내부 헬퍼 타입 ───────────────────────────────────────────────────────────

/** 수요 프로파일 */
export type DemandProfile = 'FAST' | 'INTERMITTENT' | 'COLD_START'

/** 분류기 결과 */
export type ClassifierResult = {
  profile: DemandProfile
  adi: number // Average Demand Interval
  cv2: number // Coefficient of Variation squared
  nonZeroDays: number
}
