// 제안 유형
export type SuggestionType = 'REMOVE_KEYWORD' | 'ADJUST_BID' | 'PAUSE_CAMPAIGN' | 'ADJUST_BUDGET'
export type SuggestionPriority = 'HIGH' | 'MEDIUM' | 'LOW'
export type AnalysisType = 'DAILY_REVIEW' | 'KEYWORD_AUDIT' | 'BUDGET_OPTIMIZATION' | 'CAMPAIGN_SCORING'
export type AnalysisStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

// 개선 제안
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

// 분석 개선 제안 (모델이 스스로 제안하는 규칙)
export interface ImprovementSuggestion {
  rule: string
  reason: string
}

// 분석 규칙 (사용자/모델이 설정한 분석 기준)
export interface AnalysisRule {
  id: string
  rule: string
  source: 'user' | 'model' | 'system'
  isActive: boolean
  appliedCount: number
  createdAt: string
}

// 분석 리포트
export interface AnalysisReport {
  id: string
  workspaceId: string
  periodStart: string
  periodEnd: string
  reportType: AnalysisType
  summary: string
  suggestions: Suggestion[]
  improvementSuggestions?: ImprovementSuggestion[]
  metadata?: Record<string, unknown>
  status: AnalysisStatus
  createdAt: string
}
