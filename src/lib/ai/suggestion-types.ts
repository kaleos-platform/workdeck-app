// AI 분석 입력 타입 정의

import type { AnalysisType } from '@/generated/prisma/client'

export interface AnalysisInput {
  reportType: AnalysisType
  periodStart: string
  periodEnd: string
  campaigns: CampaignSummary[]
  inefficientKeywords: InefficientKeyword[]
}

export interface CampaignSummary {
  campaignId: string
  campaignName: string
  totalAdCost: number
  totalImpressions: number
  totalClicks: number
  totalOrders: number
  totalRevenue: number
  ctr: number | null
  cvr: number | null
  roas: number | null
}

export interface InefficientKeyword {
  campaignId: string
  campaignName: string
  keyword: string
  adCost: number
  clicks: number
  impressions: number
  orders: number
  costRatio?: number
}

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

// 코드가 결정론적으로 산출한 판정 후보.
// 임계·근거 수치가 코드에서 확정되므로 재현·검증 가능. AI는 이를 재계산하지 않고
// 검토·설명·우선순위화·중복제거만 수행한다.
export interface DeterministicSignal {
  type: SuggestionType
  priority: SuggestionPriority
  campaignId: string
  campaignName: string
  target: string // 대상 키워드 또는 캠페인명
  metric: string // 판정 근거 지표 (예: 'roas', 'inefficient_keyword')
  currentValue: number | null // 현재 실측값
  thresholdValue: number | null // 판정 임계값
  appliedRule: string // 임계 출처 (예: '목표 ROAS', '기본 기준')
  reason: string // 한국어 근거 설명
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
  modelUsed: string
}
