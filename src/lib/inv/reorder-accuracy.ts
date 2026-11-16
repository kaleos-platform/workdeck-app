// 카드와 실적 모니터의 공통 평가 대상 판정.
export type AccuracyEvaluationInput = {
  forecastModel: string | null
  actualOutbound: number
}

export function accuracyExclusionReason(row: AccuracyEvaluationInput): string | null {
  if (row.forecastModel === 'MANUAL') return '수동 입력'
  if (row.actualOutbound <= 0) return '판매 없음'
  return null
}
