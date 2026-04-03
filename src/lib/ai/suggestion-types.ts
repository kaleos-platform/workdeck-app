// AI 분석 제안 타입 정의

export type SuggestionType = 'REMOVE_KEYWORD' | 'ADJUST_BID' | 'PAUSE_CAMPAIGN' | 'ADJUST_BUDGET'
export type SuggestionPriority = 'HIGH' | 'MEDIUM' | 'LOW'

export interface Suggestion {
  type: SuggestionType
  priority: SuggestionPriority
  campaignId: string
  target: string
  reason: string
  currentValue?: number
  suggestedValue?: number
  estimatedImpact?: string
}

// 모델이 제안하는 개선 규칙
export interface ImprovementSuggestion {
  rule: string
  reason: string
}

// AI 분석 최종 결과
export interface AnalysisResult {
  suggestions: Suggestion[]
  improvementSuggestions: ImprovementSuggestion[]
}
