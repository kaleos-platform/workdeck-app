/**
 * 분석 폴링 모듈
 * 30초마다 PENDING 상태의 분석 리포트를 확인하고 실행한다.
 * Worker에서 직접 OpenRouter를 호출하여 Vercel 타임아웃 제한을 회피한다.
 * 완료 후 Slack 알림을 발송한다.
 */

import { notifyAnalysisDone } from './slack-notifier.js'

const POLL_INTERVAL = 30_000 // 30초
let isProcessing = false

// OpenRouter API 설정
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const PRIMARY_MODEL = 'deepseek/deepseek-chat-v3-0324:free'
const FALLBACK_MODEL = 'qwen/qwen3-235b-a22b:free'

function getBaseUrl(): string {
  const url = process.env.WORKDECK_API_URL
  if (!url) throw new Error('WORKDECK_API_URL 환경변수가 설정되지 않았습니다')
  return url.replace(/\/$/, '')
}

function getWorkerApiKey(): string {
  const key = process.env.WORKER_API_KEY
  if (!key) throw new Error('WORKER_API_KEY 환경변수가 설정되지 않았습니다')
  return key
}

function getOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY 환경변수가 설정되지 않았습니다')
  return key
}

async function workerFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${getBaseUrl()}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-worker-api-key': getWorkerApiKey(),
    ...(options.headers as Record<string, string> | undefined),
  }
  return fetch(url, { ...options, headers })
}

/** 응답 텍스트에서 JSON 추출 */
function extractJSON(content: string): Record<string, unknown> {
  // 1. ```json ... ``` 코드블록
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()) } catch { /* next */ }
  }

  // 2. 순수 JSON
  const trimmed = content.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed) } catch { /* next */ }
  }

  // 3. 텍스트 안에서 { ... } 블록 추출
  const firstBrace = content.indexOf('{')
  const lastBrace = content.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(content.slice(firstBrace, lastBrace + 1)) } catch { /* next */ }
  }

  throw new Error(`JSON 추출 실패: ${content.slice(0, 100)}`)
}

/** OpenRouter API 호출 (Worker에서 직접 — 타임아웃 제한 없음) */
async function callOpenRouter(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ suggestions: unknown[]; improvementSuggestions: unknown[]; modelUsed: string }> {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  async function tryModel(model: string) {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getOpenRouterKey()}`,
        'HTTP-Referer': 'https://workdeck.work',
        'X-Title': 'Workdeck',
      },
      body: JSON.stringify({ model, messages }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`OpenRouter [${res.status}]: ${body.slice(0, 200)}`)
    }

    const response = await res.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> }
    const message = response.choices?.[0]?.message
    const content = message?.content || message?.reasoning_content
    if (!content) {
      console.error(`[analysis-poller] OpenRouter 빈 응답:`, JSON.stringify(response).slice(0, 500))
      throw new Error('OpenRouter 응답에 content가 없습니다')
    }

    const parsed = extractJSON(content)
    return {
      suggestions: Array.isArray(parsed) ? parsed : (Array.isArray(parsed.suggestions) ? parsed.suggestions : []),
      improvementSuggestions: Array.isArray(parsed.improvementSuggestions) ? parsed.improvementSuggestions : [],
      modelUsed: model,
    }
  }

  // Primary 모델 → Fallback
  try {
    return await tryModel(PRIMARY_MODEL)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[analysis-poller] Primary 모델 실패: ${msg}`)
    if (msg.includes('429') || msg.includes('5')) {
      console.log(`[analysis-poller] Fallback 모델로 재시도: ${FALLBACK_MODEL}`)
      return await tryModel(FALLBACK_MODEL)
    }
    throw err
  }
}

/** 분석 컨텍스트에서 사용자 프롬프트 빌드 */
function buildUserPrompt(ctx: Record<string, unknown>): string {
  const lines: string[] = [
    `분석 기간: ${ctx.periodStart} ~ ${ctx.periodEnd}`,
    '',
    '## 캠페인별 요약',
  ]

  const campaignMetas = ctx.campaignMetas as Array<{ campaignId: string; displayName: string }> ?? []
  const metaMap = new Map(campaignMetas.map((m) => [m.campaignId, m.displayName]))

  const campaigns = ctx.campaigns as Array<Record<string, unknown>> ?? []
  for (const c of campaigns) {
    const displayName = metaMap.get(c.campaignId as string) ?? c.campaignName
    lines.push(
      `- ${displayName} (${c.campaignId}): 광고비 ${Number(c.totalAdCost).toLocaleString()}원, ` +
      `노출 ${Number(c.totalImpressions).toLocaleString()}, 클릭 ${Number(c.totalClicks).toLocaleString()}, ` +
      `주문 ${c.totalOrders}, 매출 ${Number(c.totalRevenue).toLocaleString()}원, ` +
      `CTR ${c.ctr ?? 'N/A'}%, CVR ${c.cvr ?? 'N/A'}%, ROAS ${c.roas ?? 'N/A'}%`
    )
  }

  const inefficientKeywords = ctx.inefficientKeywords as Array<Record<string, unknown>> ?? []
  if (inefficientKeywords.length > 0) {
    lines.push('', '## 비효율 키워드 (광고비 > 0, 주문 = 0)')
    for (const k of inefficientKeywords) {
      lines.push(`- [${k.campaignName}] "${k.keyword}": 광고비 ${Number(k.adCost).toLocaleString()}원, 클릭 ${k.clicks}, 노출 ${k.impressions}`)
    }
  }

  return lines.join('\n')
}

export function startAnalysisPoller(): void {
  setInterval(async () => {
    if (isProcessing) return

    try {
      // 1. PENDING 분석 조회
      const pendingRes = await workerFetch('/api/analysis/reports/pending')
      if (!pendingRes.ok) return
      const pendingData = await pendingRes.json()
      if (!pendingData.report) return

      const reportId = pendingData.report.id as string
      console.log(`\n[analysis-poller] PENDING 분석 발견: ${reportId}`)
      isProcessing = true

      try {
        // 2. 컨텍스트 빌드 (API — Vercel에서 DB 쿼리만, 빠름)
        const runRes = await workerFetch(`/api/analysis/reports/${reportId}/run`, { method: 'POST' })
        if (!runRes.ok) {
          const body = await runRes.text().catch(() => '')
          console.error(`[analysis-poller] 컨텍스트 빌드 실패 [${runRes.status}]: ${body.slice(0, 200)}`)
          return
        }

        const { context } = await runRes.json() as { context: Record<string, unknown> }

        // 3. Worker에서 직접 OpenRouter 호출 (타임아웃 제한 없음)
        console.log('[analysis-poller] OpenRouter 호출 중...')
        const userPrompt = buildUserPrompt(context)
        const result = await callOpenRouter(context.systemPrompt as string, userPrompt)
        console.log(`[analysis-poller] AI 분석 완료: ${result.suggestions.length}개 제안 (${result.modelUsed})`)

        const campaigns = context.campaigns as Array<Record<string, unknown>> ?? []
        const inefficientKeywords = context.inefficientKeywords as Array<unknown> ?? []
        const activeRules = context.activeRules as Array<{ id: string }> ?? []
        const summary = `${campaigns.length}개 캠페인 분석 완료. ${result.suggestions.length}개 제안 생성.`

        // 4. 결과 저장 (API — 빠름)
        const completeRes = await workerFetch(`/api/analysis/reports/${reportId}/complete`, {
          method: 'POST',
          body: JSON.stringify({
            status: 'COMPLETED',
            summary,
            suggestions: result.suggestions,
            metadata: {
              campaignCount: campaigns.length,
              inefficientKeywordCount: inefficientKeywords.length,
              improvementSuggestions: result.improvementSuggestions,
              activeRulesCount: activeRules.length,
              activeRuleIds: activeRules.map((r) => r.id),
              model: result.modelUsed,
            },
          }),
        })

        if (completeRes.ok) {
          console.log(`[analysis-poller] 분석 완료 저장: ${reportId}`)

          // 5. Slack 알림 발송
          await notifyAnalysisDone({
            summary,
            suggestionCount: result.suggestions.length,
            campaignCount: campaigns.length,
          })
        } else {
          const body = await completeRes.text().catch(() => '')
          console.error(`[analysis-poller] 결과 저장 실패 [${completeRes.status}]: ${body.slice(0, 200)}`)
        }
      } catch (err) {
        console.error(`[analysis-poller] 분석 실행 에러: ${reportId}`, err)

        // 실패 상태 저장
        await workerFetch(`/api/analysis/reports/${reportId}/complete`, {
          method: 'POST',
          body: JSON.stringify({
            status: 'FAILED',
            summary: '',
            error: err instanceof Error ? err.message : '알 수 없는 오류',
          }),
        }).catch(() => {})
      } finally {
        isProcessing = false
      }
    } catch {
      // API 서버 미실행 등 — 조용히 무시
    }
  }, POLL_INTERVAL)

  console.log(`분석 폴링 시작 (${POLL_INTERVAL / 1000}초 간격)`)
}
