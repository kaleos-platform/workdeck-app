/**
 * 분석 폴링 모듈
 * 30초마다 PENDING 상태의 분석 리포트를 확인하고 실행한다.
 * Worker에서 직접 Gemini API를 호출하여 Vercel 타임아웃 제한을 회피한다.
 * 3차 fallback은 로컬 Ollama(워커 호스트). 완료 후 Slack 알림을 발송한다.
 */

import { notifyAnalysisDone, notifyAnalysisFailed } from './slack-notifier.js'

const POLL_INTERVAL = 30_000 // 30초
let isProcessing = false

// AI 모델 설정 (환경변수로 전환 가능)
const GEMINI_PRIMARY_MODEL = process.env.AI_PRIMARY_MODEL || 'gemini-2.5-flash'
const GEMINI_FALLBACK_MODEL = process.env.AI_FALLBACK_MODEL || 'gemini-2.5-pro'
// 3차 fallback: 워커 호스트(맥미니) 로컬 Ollama. OPENROUTER 모델 ID는 폐기됨(qwen3.6-plus 미존재).
const OLLAMA_FALLBACK_MODEL = process.env.AI_LOCAL_FALLBACK_MODEL || 'qwen3:14b'
const OLLAMA_ENDPOINT = (process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434').replace(/\/$/, '')

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
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {
      /* next */
    }
  }

  // 2. 순수 JSON
  const trimmed = content.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      /* next */
    }
  }

  // 3. 텍스트 안에서 { ... } 블록 추출
  const firstBrace = content.indexOf('{')
  const lastBrace = content.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(content.slice(firstBrace, lastBrace + 1))
    } catch {
      /* next */
    }
  }

  throw new Error(`JSON 추출 실패: ${content.slice(0, 100)}`)
}

type AnalysisResult = {
  suggestions: unknown[]
  improvementSuggestions: unknown[]
  modelUsed: string
}

function parseAnalysisResponse(content: string, model: string): AnalysisResult {
  const parsed = extractJSON(content)
  return {
    suggestions: Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.suggestions)
        ? parsed.suggestions
        : [],
    improvementSuggestions: Array.isArray(parsed.improvementSuggestions)
      ? parsed.improvementSuggestions
      : [],
    modelUsed: model,
  }
}

/** Gemini API 호출 */
async function callGemini(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<AnalysisResult> {
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

  const response = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const content = response.candidates?.[0]?.content?.parts?.[0]?.text
  if (!content) {
    console.error(`[analysis-poller] Gemini 빈 응답:`, JSON.stringify(response).slice(0, 500))
    throw new Error('Gemini 응답에 content가 없습니다')
  }

  return parseAnalysisResponse(content, model)
}

/** Ollama 로컬 호출 (워커 호스트 = 맥미니에서만 가용) */
async function callOllama(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<AnalysisResult> {
  const res = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      format: 'json',
      stream: false,
      options: { temperature: 0.3 },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Ollama [${res.status}]: ${body.slice(0, 200)}`)
  }

  const response = (await res.json()) as { message?: { content?: string } }
  const content = response.message?.content
  if (!content) throw new Error('Ollama 응답에 content가 없습니다')

  return parseAnalysisResponse(content, model)
}

/**
 * Gemini 키·결제 오류(401·402·403, 무효 키 400, 키 미설정) 여부 — 같은 키를 쓰는 다른 Gemini 모델도 실패하므로
 * pro 단계를 건너뛴다. 상태 코드는 callGemini 오류 메시지 `Gemini [NNN]` 에서 읽는다.
 */
export function isGeminiKeyError(message: string): boolean {
  // 무효·만료 키는 401/403 이 아니라 400 + "API key not valid"(reason API_KEY_INVALID)로 온다(2026-11-24 실측).
  if (
    message.includes('GEMINI_API_KEY') ||
    /API key (not valid|expired)|API_KEY_INVALID/.test(message)
  )
    return true
  const status = Number(message.match(/Gemini \[(\d{3})\]/)?.[1])
  return status === 401 || status === 402 || status === 403
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * AI 분석 호출 — Gemini flash → (키 오류가 아니면) Gemini pro → 로컬 Ollama.
 * 전부 실패하면 단계별 오류를 합쳐 throw — 마지막 Ollama 오류에 Gemini 402 가 가려지지 않게.
 * 예비 모델로 성공해도 Gemini 키 오류였다면 geminiError 로 돌려줘 호출자가 알린다.
 */
export async function callAnalysisAI(
  systemPrompt: string,
  userPrompt: string
): Promise<AnalysisResult & { geminiError?: string }> {
  const errors: string[] = []

  try {
    return await callGemini(GEMINI_PRIMARY_MODEL, systemPrompt, userPrompt)
  } catch (err) {
    errors.push(`${GEMINI_PRIMARY_MODEL}: ${errMsg(err)}`)
    console.warn(`[analysis-poller] Primary 실패 (${GEMINI_PRIMARY_MODEL}): ${errMsg(err)}`)
  }
  const keyError = isGeminiKeyError(errors[0])

  if (!keyError) {
    try {
      console.log(`[analysis-poller] Fallback 1 재시도: ${GEMINI_FALLBACK_MODEL}`)
      return await callGemini(GEMINI_FALLBACK_MODEL, systemPrompt, userPrompt)
    } catch (err) {
      errors.push(`${GEMINI_FALLBACK_MODEL}: ${errMsg(err)}`)
      console.warn(`[analysis-poller] Fallback 1 실패 (${GEMINI_FALLBACK_MODEL}): ${errMsg(err)}`)
    }
  } else {
    console.warn('[analysis-poller] Gemini 키·결제 오류 — pro 건너뛰고 로컬 모델로 전환')
  }

  try {
    console.log(`[analysis-poller] Fallback 2 재시도 (local): ${OLLAMA_FALLBACK_MODEL}`)
    const result = await callOllama(OLLAMA_FALLBACK_MODEL, systemPrompt, userPrompt)
    // flash 가 5xx 였고 pro 가 402 인 경우도 키 문제다 — 어느 Gemini 단계든 키 오류면 알린다.
    const geminiKeyErr = errors.find(isGeminiKeyError)
    return geminiKeyErr ? { ...result, geminiError: geminiKeyErr } : result
  } catch (err) {
    errors.push(`${OLLAMA_FALLBACK_MODEL}: ${errMsg(err)}`)
    throw new Error(errors.join(' / '))
  }
}

// 같은 workspace·같은 종류 알림은 KST 하루 1회. analysisHour 미지정이면 실패 후 매 정시 재시도되기 때문.
// ponytail: 메모리 Map 이라 워커 재시작 시 초기화 — 재시작은 드물어 허용, 필요해지면 서버 측 기록으로.
const lastFailureAlert = new Map<string, string>()

/** 분석 실패/주의 알림 — 하루 1회 억제, 발송 실패는 로그만. 테스트용으로 export. */
export async function alertAnalysisProblem(params: {
  error: string
  workspaceId?: string
  recoveredBy?: string
}): Promise<void> {
  const geminiKeyError = isGeminiKeyError(params.error)
  const kind = params.recoveredBy ? 'recovered' : geminiKeyError ? 'key' : 'failed'
  const key = `${params.workspaceId ?? '-'}:${kind}`
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
  if (lastFailureAlert.get(key) === today) {
    console.log(`[analysis-poller] 같은 실패 알림 오늘 이미 발송 — 생략 (${kind})`)
    return
  }
  try {
    const sent = await notifyAnalysisFailed({ ...params, geminiKeyError })
    if (sent) lastFailureAlert.set(key, today)
    else console.error('[analysis-poller] 분석 실패 알림 미발송(채널·토글·대상 조회 확인 필요)')
  } catch (err) {
    console.error('[analysis-poller] 분석 실패 알림 발송 에러:', err)
  }
}

/** 분석 컨텍스트에서 사용자 프롬프트 빌드 */
function buildUserPrompt(ctx: Record<string, unknown>): string {
  const lines: string[] = [
    `분석 기간: ${ctx.periodStart} ~ ${ctx.periodEnd}`,
    '',
    '## 캠페인별 요약',
  ]

  const campaignMetas =
    (ctx.campaignMetas as Array<{ campaignId: string; displayName: string }>) ?? []
  const metaMap = new Map(campaignMetas.map((m) => [m.campaignId, m.displayName]))

  const campaigns = (ctx.campaigns as Array<Record<string, unknown>>) ?? []
  for (const c of campaigns) {
    const displayName = metaMap.get(c.campaignId as string) ?? c.campaignName
    lines.push(
      `- ${displayName} (${c.campaignId}): 광고비 ${Number(c.totalAdCost).toLocaleString()}원, ` +
        `노출 ${Number(c.totalImpressions).toLocaleString()}, 클릭 ${Number(c.totalClicks).toLocaleString()}, ` +
        `주문 ${c.totalOrders}, 매출 ${Number(c.totalRevenue).toLocaleString()}원, ` +
        `CTR ${c.ctr ?? 'N/A'}%, CVR ${c.cvr ?? 'N/A'}%, ROAS ${c.roas ?? 'N/A'}%`
    )
  }

  // 코드가 결정론적으로 산출한 판정 후보 — 임계·근거가 확정되어 있으므로 재계산 금지.
  const signals = (ctx.deterministicSignals as Array<Record<string, unknown>>) ?? []
  if (signals.length > 0) {
    lines.push(
      '',
      '## 코드가 식별한 판정 후보 (근거·임계 확정 — 재계산 말고 검토·설명·우선순위화)',
      '아래 후보는 코드가 사용자 목표·통계 기준으로 이미 판정한 것입니다. 각 후보를 suggestions로',
      '변환하되 임계값을 임의로 바꾸지 말고, appliedRule과 근거 수치를 그대로 반영하세요.'
    )
    for (const s of signals) {
      const cur = s.currentValue != null ? String(s.currentValue) : '-'
      const thr = s.thresholdValue != null ? String(s.thresholdValue) : '-'
      lines.push(
        `- [${s.type}·${s.priority}] ${s.campaignName} / 대상 "${s.target}" — ` +
          `${s.metric}=${cur} (임계 ${thr}, 규칙: ${s.appliedRule}). ${s.reason}`
      )
    }
  }

  const inefficientKeywords = (ctx.inefficientKeywords as Array<Record<string, unknown>>) ?? []
  if (inefficientKeywords.length > 0) {
    lines.push('', '## 비효율 키워드 원자료 (위 후보의 근거 상세)')
    for (const k of inefficientKeywords) {
      const costRatioStr = k.costRatio != null ? `, 캠페인 광고비 대비 ${k.costRatio}%` : ''
      lines.push(
        `- [${k.campaignName}] "${k.keyword}": 광고비 ${Number(k.adCost).toLocaleString()}원, 클릭 ${k.clicks}, 노출 ${k.impressions}${costRatioStr}`
      )
    }
  }

  // 제거된 키워드 히스토리
  const removedKeywords = (ctx.removedKeywords as Array<Record<string, unknown>>) ?? []
  if (removedKeywords.length > 0) {
    lines.push('', '## 이미 제거된 키워드 (다시 제안하지 마세요)')
    for (const k of removedKeywords) {
      const memo = k.removedMemo ? ` (사유: ${k.removedMemo})` : ''
      const removedDate = k.removedAt ? String(k.removedAt).split('T')[0] : ''
      lines.push(`- [${k.campaignId}] "${k.keyword}" — 제거일: ${removedDate}${memo}`)
    }
  }

  // 캠페인 목표 설정
  const campaignTargets = (ctx.campaignTargets as Array<Record<string, unknown>>) ?? []
  if (campaignTargets.length > 0) {
    lines.push('', '## 캠페인 목표 설정 (목표 ROAS 대비 실적 비교 필요)')
    const seen = new Set<string>()
    for (const t of campaignTargets) {
      const cid = t.campaignId as string
      if (seen.has(cid)) continue
      seen.add(cid)
      const budget =
        t.dailyBudget != null
          ? `일예산 ${Number(t.dailyBudget).toLocaleString()}원`
          : '일예산 미설정'
      const roas = t.targetRoas != null ? `목표 ROAS ${t.targetRoas}%` : '목표 ROAS 미설정'
      lines.push(`- ${cid}: ${budget}, ${roas}`)
    }
  }

  // 최근 메모 (사용자 조치 내역)
  const recentMemos = (ctx.recentMemos as Array<Record<string, unknown>>) ?? []
  if (recentMemos.length > 0) {
    lines.push('', '## 최근 광고 운영 메모 (사용자가 직접 기록한 조치 내역 — 반드시 참고)')
    for (const m of recentMemos.slice(0, 30)) {
      const memoDate = m.date ? String(m.date).split('T')[0] : ''
      lines.push(`- [${m.campaignId}] ${memoDate}: ${m.content}`)
    }
  }

  // 규칙 리마인더 (시스템 프롬프트에도 있지만, 사용자 프롬프트 말미에 다시 강조)
  const activeRules = (ctx.activeRules as Array<{ id: string; rule: string }>) ?? []
  if (activeRules.length > 0) {
    lines.push('', '## 적용할 규칙 리마인더 (수치 기준을 반드시 준수)')
    for (let i = 0; i < activeRules.length; i++) {
      lines.push(`규칙 ${i + 1}. ${activeRules[i].rule}`)
    }
    lines.push(
      '위 규칙에 명시된 수치를 임의로 변경하지 마세요. 각 suggestion의 appliedRule 필드에 적용한 규칙 번호를 명시하세요.'
    )
  }

  return lines.join('\n')
}

/**
 * 분석 완료 Slack 알림 발송 — 분석 파이프라인에서 분리된 부수효과.
 * @param enabled complete 응답의 slackNotify 게이트. false면 발송 스킵.
 * 발송 실패는 로그만 남기고 삼켜 분석 결과에 영향을 주지 않는다.
 */
async function maybeNotifyAnalysisDone(
  enabled: boolean,
  params: {
    summary: string
    suggestionCount: number
    campaignCount: number
    workspaceId?: string
    topSuggestions?: Array<{ type: string; priority: string; target: string; reason: string }>
  }
): Promise<void> {
  if (!enabled) {
    console.log('[analysis-poller] slackNotify=false — 분석 완료 알림 스킵')
    return
  }
  try {
    await notifyAnalysisDone(params)
  } catch (err) {
    console.error('[analysis-poller] 분석 완료 알림 발송 실패(무시):', err)
  }
}

/** 분석 최종 실패 — FAILED 저장과 Slack 알림을 서로 독립적으로 시도한다. 테스트용으로 export. */
export async function handleAnalysisFailure(
  reportId: string,
  workspaceId: string | undefined,
  err: unknown
): Promise<void> {
  const error = err instanceof Error ? err.message : '알 수 없는 오류'
  try {
    const res = await workerFetch(`/api/analysis/reports/${reportId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ status: 'FAILED', summary: '', error }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[analysis-poller] FAILED 저장 실패 [${res.status}]: ${body.slice(0, 200)}`)
    }
  } catch (saveErr) {
    console.error('[analysis-poller] FAILED 저장 요청 에러:', saveErr)
  }
  await alertAnalysisProblem({ error, workspaceId })
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
      const workspaceId = pendingData.report.workspaceId as string | undefined
      console.log(`\n[analysis-poller] PENDING 분석 발견: ${reportId}`)
      isProcessing = true

      try {
        // 2. 컨텍스트 빌드 (API — Vercel에서 DB 쿼리만, 빠름)
        const runRes = await workerFetch(`/api/analysis/reports/${reportId}/run`, {
          method: 'POST',
        })
        if (!runRes.ok) {
          const body = await runRes.text().catch(() => '')
          console.error(
            `[analysis-poller] 컨텍스트 빌드 실패 [${runRes.status}]: ${body.slice(0, 200)}`
          )
          // /run 이 claim 후 빌드에 실패하면 서버가 이미 FAILED 로 저장하고 { status: 'FAILED' } 를 준다 — 알림만.
          // (claim 실패 409 등은 다른 워커가 처리 중이므로 알리지 않는다)
          if (body.includes('"FAILED"')) {
            await alertAnalysisProblem({
              error: `컨텍스트 빌드 실패: ${body.slice(0, 200)}`,
              workspaceId,
            })
          }
          return
        }

        const { context } = (await runRes.json()) as { context: Record<string, unknown> }

        // 3. Worker에서 직접 AI 호출 (3단계 fallback: Gemini flash → pro → 로컬 Ollama)
        console.log('[analysis-poller] AI 분석 호출 중...')
        const userPrompt = buildUserPrompt(context)
        const result = await callAnalysisAI(context.systemPrompt as string, userPrompt)
        console.log(
          `[analysis-poller] AI 분석 완료: ${result.suggestions.length}개 제안 (${result.modelUsed})`
        )
        if (result.geminiError) {
          await alertAnalysisProblem({
            error: result.geminiError,
            workspaceId,
            recoveredBy: result.modelUsed,
          })
        }

        const campaigns = (context.campaigns as Array<Record<string, unknown>>) ?? []
        const inefficientKeywords = (context.inefficientKeywords as Array<unknown>) ?? []
        const activeRules = (context.activeRules as Array<{ id: string }>) ?? []
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

          // 5. Slack 알림 발송 — 분석/저장과 분리된 부수효과.
          //    발송 여부는 complete 응답의 slackNotify 게이트를 따르며, 발송 실패가 분석 결과에 영향 없도록 격리.
          const completeBody = (await completeRes.json().catch(() => ({}))) as {
            slackNotify?: boolean
          }
          await maybeNotifyAnalysisDone(completeBody.slackNotify !== false, {
            summary,
            suggestionCount: result.suggestions.length,
            campaignCount: campaigns.length,
            workspaceId,
            topSuggestions: (result.suggestions as Array<Record<string, unknown>>).map((s) => ({
              type: String(s.type),
              priority: String(s.priority),
              target: String(s.target),
              reason: String(s.reason ?? ''),
            })),
          })
        } else {
          const body = await completeRes.text().catch(() => '')
          console.error(
            `[analysis-poller] 결과 저장 실패 [${completeRes.status}]: ${body.slice(0, 200)}`
          )
        }
      } catch (err) {
        console.error(`[analysis-poller] 분석 실행 에러: ${reportId}`, err)

        await handleAnalysisFailure(reportId, workspaceId, err)
      } finally {
        isProcessing = false
      }
    } catch {
      // API 서버 미실행 등 — 조용히 무시
    }
  }, POLL_INTERVAL)

  console.log(`분석 폴링 시작 (${POLL_INTERVAL / 1000}초 간격)`)
}
