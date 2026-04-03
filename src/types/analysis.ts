export type SuggestionType = 'REMOVE_KEYWORD' | 'ADJUST_BID' | 'PAUSE_CAMPAIGN' | 'ADJUST_BUDGET'
export type SuggestionPriority = 'HIGH' | 'MEDIUM' | 'LOW'
export type AnalysisType =
  | 'DAILY_REVIEW'
  | 'KEYWORD_AUDIT'
  | 'BUDGET_OPTIMIZATION'
  | 'CAMPAIGN_SCORING'
export type AnalysisStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

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

export interface AnalysisReport {
  id: string
  workspaceId: string
  periodStart: string
  periodEnd: string
  reportType: AnalysisType
  summary: string
  suggestions: Suggestion[]
  status: AnalysisStatus
  createdAt: string
}
