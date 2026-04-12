/**
 * 분석 폴링 모듈
 * 30초마다 PENDING 상태의 분석 리포트를 확인하고 실행한다.
 * Worker에서 직접 OpenRouter를 호출하여 Vercel 타임아웃 제한을 회피한다.
 * 완료 후 Slack 알림을 발송한다.
 */

import { notifyAnalysisDone } from './slack-notifier.js'

const POLL_INTERVAL = 30_000 // 30초
let isProcessing = false

// Gemini API 설정
const GEMINI_PRIMARY_MODEL = 'gemini-2.5-flash'
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-pro'

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

function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다')
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

/** Gemini API 호출 (Worker에서 직접 — 타임아웃 제한 없음) */
async function callGemini(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ suggestions: unknown[]; improvementSuggestions: unknown[]; modelUsed: string }> {
  async function tryModel(model: string) {
    const apiKey = getGeminiApiKey()
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.3,
          maxOutputTokens: 65536,
          thinkingConfig: { thinkingBudget: 2048 },
        },
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Gemini [${res.status}]: ${body.slice(0, 200)}`)
    }

    const response = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const content = response.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) {
      console.error(`[analysis-poller] Gemini 빈 응답:`, JSON.stringify(response).slice(0, 500))
      throw new Error('Gemini 응답에 content가 없습니다')
    }

    const parsed = extractJSON(content)
    return {
      suggestions: Array.isArray(parsed) ? parsed : (Array.isArray(parsed.suggestions) ? parsed.suggestions : []),
      improvementSuggestions: Array.isArray(parsed.improvementSuggestions) ? parsed.improvementSuggestions : [],
      modelUsed: model,
    }
  }

  // Primary → Fallback
  try {
    return await tryModel(GEMINI_PRIMARY_MODEL)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[analysis-poller] Primary 모델 실패 (${GEMINI_PRIMARY_MODEL}): ${msg}`)
    if (msg.includes('429') || msg.includes('5')) {
      console.log(`[analysis-poller] Fallback 모델로 재시도: ${GEMINI_FALLBACK_MODEL}`)
      return await tryModel(GEMINI_FALLBACK_MODEL)
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
      const costRatioStr = k.costRatio != null ? `, 캠페인 광고비 대비 ${k.costRatio}%` : ''
      lines.push(`- [${k.campaignName}] "${k.keyword}": 광고비 ${Number(k.adCost).toLocaleString()}원, 클릭 ${k.clicks}, 노출 ${k.impressions}${costRatioStr}`)
    }
  }

  // 제거된 키워드 히스토리
  const removedKeywords = ctx.removedKeywords as Array<Record<string, unknown>> ?? []
  if (removedKeywords.length > 0) {
    lines.push('', '## 이미 제거된 키워드 (다시 제안하지 마세요)')
    for (const k of removedKeywords) {
      const memo = k.removedMemo ? ` (사유: ${k.removedMemo})` : ''
      const removedDate = k.removedAt ? String(k.removedAt).split('T')[0] : ''
      lines.push(`- [${k.campaignId}] "${k.keyword}" — 제거일: ${removedDate}${memo}`)
    }
  }

  // 캠페인 목표 설정
  const campaignTargets = ctx.campaignTargets as Array<Record<string, unknown>> ?? []
  if (campaignTargets.length > 0) {
    lines.push('', '## 캠페인 목표 설정 (목표 ROAS 대비 실적 비교 필요)')
    const seen = new Set<string>()
    for (const t of campaignTargets) {
      const cid = t.campaignId as string
      if (seen.has(cid)) continue
      seen.add(cid)
      const budget = t.dailyBudget != null ? `일예산 ${Number(t.dailyBudget).toLocaleString()}원` : '일예산 미설정'
      const roas = t.targetRoas != null ? `목표 ROAS ${t.targetRoas}%` : '목표 ROAS 미설정'
      lines.push(`- ${cid}: ${budget}, ${roas}`)
    }
  }

  // 최근 메모 (사용자 조치 내역)
  const recentMemos = ctx.recentMemos as Array<Record<string, unknown>> ?? []
  if (recentMemos.length > 0) {
    lines.push('', '## 최근 광고 운영 메모 (사용자가 직접 기록한 조치 내역 — 반드시 참고)')
    for (const m of recentMemos.slice(0, 30)) {
      const memoDate = m.date ? String(m.date).split('T')[0] : ''
      lines.push(`- [${m.campaignId}] ${memoDate}: ${m.content}`)
    }
  }

  // 규칙 리마인더 (시스템 프롬프트에도 있지만, 사용자 프롬프트 말미에 다시 강조)
  const activeRules = ctx.activeRules as Array<{ id: string; rule: string }> ?? []
  if (activeRules.length > 0) {
    lines.push('', '## 적용할 규칙 리마인더 (수치 기준을 반드시 준수)')
    for (let i = 0; i < activeRules.length; i++) {
      lines.push(`규칙 ${i + 1}. ${activeRules[i].rule}`)
    }
    lines.push('위 규칙에 명시된 수치를 임의로 변경하지 마세요. 각 suggestion의 appliedRule 필드에 적용한 규칙 번호를 명시하세요.')
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

        // 3. Worker에서 직접 Gemini API 호출 (타임아웃 제한 없음)
        console.log('[analysis-poller] Gemini API 호출 중...')
        const userPrompt = buildUserPrompt(context)
        const result = await callGemini(context.systemPrompt as string, userPrompt)
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
