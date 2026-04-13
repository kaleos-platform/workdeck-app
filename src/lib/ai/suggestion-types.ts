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
