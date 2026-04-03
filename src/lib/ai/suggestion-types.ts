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
