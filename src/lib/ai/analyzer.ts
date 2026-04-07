// AI 분석 엔진 — OpenRouter 기반 광고 성과 분석

import type { AnalysisType } from '@/generated/prisma/client'
import { getSystemPrompt } from './prompts'
import type { Suggestion, AnalysisResult, ImprovementSuggestion } from './suggestion-types'
import type { AnalysisContext } from '@/lib/analysis/data-builder'

// OpenRouter API 설정
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ''

// 모델 우선순위 (무료 티어)
const PRIMARY_MODEL = 'qwen/qwen3.6-plus:free'
const FALLBACK_MODEL = 'minimax/minimax-m2.5:free'

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
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY 환경변수가 설정되지 않았습니다')
  }

  const systemPrompt = getSystemPrompt(data.reportType, data.activeRules)
  const userPrompt = buildUserPrompt(data)
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  // Primary 모델 시도
  try {
    return await callOpenRouter(PRIMARY_MODEL, messages)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[analyzer] Primary 모델 실패 (${PRIMARY_MODEL}): ${message}`)

    // 429 또는 5xx인 경우 fallback
    if (message.includes('429') || message.includes('5')) {
      console.log(`[analyzer] Fallback 모델로 재시도: ${FALLBACK_MODEL}`)
      return await callOpenRouter(FALLBACK_MODEL, messages)
    }

    throw err
  }
}

/** 응답 텍스트에서 JSON을 추출 — 코드블록, 마크다운 혼합, 순수 JSON 모두 처리 */
function extractJSON(content: string): Record<string, unknown> {
  // 1. ```json ... ``` 코드블록에서 추출
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {
      // 코드블록 안이 유효하지 않은 JSON — 다음 방법 시도
    }
  }

  // 2. 순수 JSON (전체 텍스트)
  const trimmed = content.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // 전체가 유효하지 않은 JSON — 다음 방법 시도
    }
  }

  // 3. 텍스트 안에서 첫 번째 { ... } 블록 추출
  const firstBrace = content.indexOf('{')
  const lastBrace = content.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(content.slice(firstBrace, lastBrace + 1))
    } catch {
      // 추출 실패
    }
  }

  throw new Error(`AI 응답에서 JSON을 추출할 수 없습니다: ${content.slice(0, 200)}`)
}

/** OpenRouter API 호출 */
async function callOpenRouter(
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<AnalysisResult> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://workdeck.work',
      'X-Title': 'Workdeck',
    },
    body: JSON.stringify({ model, messages }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenRouter API 에러 [${res.status}]: ${body.slice(0, 200)}`)
  }

  const response = await res.json()
  const content = response.choices?.[0]?.message?.content

  if (!content) {
    throw new Error('OpenRouter 응답에 content가 없습니다')
  }

  // JSON 파싱 — 코드블록, 마크다운 혼합, 순수 JSON 모두 처리
  const parsed = extractJSON(content)

  const suggestions: Suggestion[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : []

  const improvementSuggestions: ImprovementSuggestion[] = Array.isArray(parsed.improvementSuggestions)
    ? parsed.improvementSuggestions
    : []

  return { suggestions, improvementSuggestions, modelUsed: model }
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
