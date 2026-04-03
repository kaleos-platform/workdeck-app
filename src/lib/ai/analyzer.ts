// AI 분석 엔진 — Ollama 기반 광고 성과 분석

import { Ollama } from 'ollama'
import type { AnalysisType } from '@/generated/prisma/client'
import { getSystemPrompt } from './prompts'
import type { Suggestion } from './suggestion-types'

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
 * 광고 성과 데이터를 AI로 분석하여 제안 목록을 반환
 */
export async function analyzeAdPerformance(data: AnalysisInput): Promise<Suggestion[]> {
  const systemPrompt = getSystemPrompt(data.reportType)

  // 사용자 프롬프트 구성
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

  // 배열이 아닌 경우 배열로 감싸기 (모델이 { suggestions: [...] } 형태로 반환할 수 있음)
  const suggestions: Suggestion[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : []

  return suggestions
}

/** 분석 데이터를 사용자 프롬프트 문자열로 변환 */
function buildUserPrompt(data: AnalysisInput): string {
  const lines: string[] = [
    `분석 기간: ${data.periodStart} ~ ${data.periodEnd}`,
    '',
    '## 캠페인별 요약',
  ]

  for (const c of data.campaigns) {
    lines.push(
      `- ${c.campaignName} (${c.campaignId}): 광고비 ${c.totalAdCost.toLocaleString()}원, ` +
      `노출 ${c.totalImpressions.toLocaleString()}, 클릭 ${c.totalClicks.toLocaleString()}, ` +
      `주문 ${c.totalOrders}, 매출 ${c.totalRevenue.toLocaleString()}원, ` +
      `CTR ${c.ctr ?? 'N/A'}%, CVR ${c.cvr ?? 'N/A'}%, ROAS ${c.roas ?? 'N/A'}%`
    )
  }

  if (data.inefficientKeywords.length > 0) {
    lines.push('', '## 비효율 키워드 (광고비 > 0, 주문 = 0)')
    for (const k of data.inefficientKeywords) {
      lines.push(
        `- [${k.campaignName}] "${k.keyword}": 광고비 ${k.adCost.toLocaleString()}원, ` +
        `클릭 ${k.clicks}, 노출 ${k.impressions}`
      )
    }
  }

  return lines.join('\n')
}
