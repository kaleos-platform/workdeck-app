// AI 분석 엔진 — Ollama 기반 광고 성과 분석

import { Ollama } from 'ollama'
import type { AnalysisType } from '@/generated/prisma/client'
import { getSystemPrompt } from './prompts'
import type { Suggestion, AnalysisResult, ImprovementSuggestion } from './suggestion-types'
import type { AnalysisContext } from '@/lib/analysis/data-builder'

// Ollama 클라이언트 초기화 (환경변수 fallback)
const ollama = new Ollama({
  host: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
})

const MODEL = 'qwen3:14b'

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
}

/**
 * 광고 성과 데이터를 AI로 분석하여 제안 목록 + 개선 규칙을 반환
 */
export async function analyzeAdPerformance(data: AnalysisContext): Promise<AnalysisResult> {
  // 활성 규칙을 시스템 프롬프트에 주입
  const systemPrompt = getSystemPrompt(data.reportType, data.activeRules)

  // 사용자 프롬프트 구성 (확장된 컨텍스트 포함)
  const userPrompt = buildUserPrompt(data)

  const response = await ollama.chat({
    model: MODEL,
    format: 'json',
    stream: false,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  // 응답 파싱
  const content = response.message.content
  const parsed = JSON.parse(content)

  // suggestions 파싱 — 배열 또는 { suggestions: [...] } 형태 모두 처리
  const suggestions: Suggestion[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : []

  // improvementSuggestions 파싱
  const improvementSuggestions: ImprovementSuggestion[] = Array.isArray(parsed.improvementSuggestions)
    ? parsed.improvementSuggestions
    : []

  return { suggestions, improvementSuggestions }
}

/** 분석 데이터를 사용자 프롬프트 문자열로 변환 (확장) */
function buildUserPrompt(data: AnalysisContext): string {
  const lines: string[] = [
    `분석 기간: ${data.periodStart} ~ ${data.periodEnd}`,
    '',
    '## 캠페인별 요약',
  ]

  // 캠페인 표시명 매핑
  const metaMap = new Map(data.campaignMetas.map((m) => [m.campaignId, m.displayName]))

  for (const c of data.campaigns) {
    const displayName = metaMap.get(c.campaignId) ?? c.campaignName
    lines.push(
      `- ${displayName} (${c.campaignId}): 광고비 ${c.totalAdCost.toLocaleString()}원, ` +
      `노출 ${c.totalImpressions.toLocaleString()}, 클릭 ${c.totalClicks.toLocaleString()}, ` +
      `주문 ${c.totalOrders}, 매출 ${c.totalRevenue.toLocaleString()}원, ` +
      `CTR ${c.ctr ?? 'N/A'}%, CVR ${c.cvr ?? 'N/A'}%, ROAS ${c.roas ?? 'N/A'}%`
    )
  }

  // 비효율 키워드
  if (data.inefficientKeywords.length > 0) {
    lines.push('', '## 비효율 키워드 (광고비 > 0, 주문 = 0)')
    for (const k of data.inefficientKeywords) {
      lines.push(
        `- [${k.campaignName}] "${k.keyword}": 광고비 ${k.adCost.toLocaleString()}원, ` +
        `클릭 ${k.clicks}, 노출 ${k.impressions}`
      )
    }
  }

  // 제거된 키워드 히스토리
  if (data.removedKeywords.length > 0) {
    lines.push('', '## 이미 제거된 키워드 (다시 제안하지 마세요)')
    for (const k of data.removedKeywords) {
      const memo = k.removedMemo ? ` (사유: ${k.removedMemo})` : ''
      lines.push(
        `- [${k.campaignId}] "${k.keyword}" — 제거일: ${k.removedAt.toISOString().split('T')[0]}${memo}`
      )
    }
  }

  // 제거된 상품 히스토리
  if (data.removedProducts.length > 0) {
    lines.push('', '## 이미 제거된 상품 (다시 제안하지 마세요)')
    for (const p of data.removedProducts) {
      lines.push(
        `- [${p.campaignId}] "${p.productName}" (옵션: ${p.optionId || '-'}) — 제거일: ${p.removedAt.toISOString().split('T')[0]}`
      )
    }
  }

  // 캠페인 목표 ROAS / 일예산
  if (data.campaignTargets.length > 0) {
    lines.push('', '## 캠페인 목표 설정 (목표 ROAS 대비 실적 비교 필요)')
    // 캠페인별 최신 목표만 표시
    const latestTargets = new Map<string, typeof data.campaignTargets[0]>()
    for (const t of data.campaignTargets) {
      if (!latestTargets.has(t.campaignId)) {
        latestTargets.set(t.campaignId, t)
      }
    }
    for (const [campaignId, t] of latestTargets) {
      const budget = t.dailyBudget != null ? `일예산 ${t.dailyBudget.toLocaleString()}원` : '일예산 미설정'
      const roas = t.targetRoas != null ? `목표 ROAS ${t.targetRoas}%` : '목표 ROAS 미설정'
      lines.push(`- ${campaignId}: ${budget}, ${roas}`)
    }
  }

  // 최근 메모
  if (data.recentMemos.length > 0) {
    lines.push('', '## 최근 광고 운영 메모 (참고용)')
    for (const m of data.recentMemos.slice(0, 20)) {
      lines.push(
        `- [${m.campaignId}] ${m.date.toISOString().split('T')[0]}: ${m.content}`
      )
    }
  }

  return lines.join('\n')
}
