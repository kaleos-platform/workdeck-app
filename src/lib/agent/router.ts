import { prisma } from '@/lib/prisma'
import { toolDefinitions } from '@/lib/agent/tools'
import type { ToolDefinition } from '@/lib/agent/tools'
import { buildAppUrl } from '@/lib/domain'
import { checkAndIncrementUsage, recordTokens } from './llm/usage'
import { runAgentLoop } from './llm/agent-loop'
import { loadConversation, appendConversation } from './llm/conversation'

/**
 * 하이브리드 워크덱 에이전트 라우터.
 *
 * 1단계: 정형 명령(정규식) 우선 — LLM 토큰 0으로 대응 tool을 직접 실행하고 한국어로 포맷.
 * 2단계: 미매칭 → SpaceAgent 활성 확인 → 일일 LLM 한도 확인 → LLM 루프(대화 세션 유지).
 *
 * (레거시 에밀리 slack-handler.ts의 정규식 12종을 spaceId 파라미터화해 이식.)
 */

// tool 조회 헬퍼 — 이름으로 ToolDefinition 찾기.
const toolByName = new Map<string, ToolDefinition>(toolDefinitions.map((d) => [d.name, d]))

function getTool(name: string): ToolDefinition | undefined {
  return toolByName.get(name)
}

// 오늘 기준 기간 유틸(KST 벽시계). 정형 명령의 기본 조회 기간에 사용.
function todayYmd(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function daysAgoYmd(days: number): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000 - days * 24 * 60 * 60 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function won(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '-'
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

export interface RouteArgs {
  spaceId: string
  requestedBy: string // tool ctx.userId (해석된 행위 사용자)
  channelId: string
  threadTs: string
  text: string
}

export interface RouteResult {
  text: string
}

const HELP_TEXT = [
  '*워크덱 에이전트 명령 안내*',
  '',
  '• `상태` / `현황` / `KPI` — 쿠팡 광고 KPI 요약',
  '• `캠페인 목록` — 캠페인 리스트',
  '• `캠페인 <이름 또는 ID>` — 캠페인 상세',
  '• `비효율` — 비효율(지출 있으나 주문 0) 키워드',
  '• `분석` — AI 광고 분석 실행(승인 필요)',
  '• `리포트` — 최근 분석 리포트',
  '• `태스크` — 승인 대기 목록',
  '• `도움` — 이 안내',
  '',
  '이 외에도 자연어로 자유롭게 질문하세요. 예: "이번 달 지출이 얼마야?", "재고 부족한 상품 알려줘"',
].join('\n')

/**
 * Slack 멘션 텍스트를 라우팅한다. 정형 명령이면 tool 직접 실행, 아니면 LLM 폴백.
 */
export async function routeAgentMessage(args: RouteArgs): Promise<RouteResult> {
  const text = args.text.trim()

  // ── 1단계: 정형 명령 ────────────────────────────────────────────────────
  const structured = await tryStructuredCommand(args, text)
  if (structured !== null) return { text: structured }

  // ── 2단계: LLM 폴백 ─────────────────────────────────────────────────────
  // Space 에이전트 활성 여부(레코드 없으면 기본 활성).
  const toggle = await prisma.spaceAgent.findUnique({
    where: { spaceId: args.spaceId },
    select: { isActive: true },
  })
  if (toggle && !toggle.isActive) {
    return {
      text: '이 워크스페이스의 AI 어시스턴트가 비활성화되어 있습니다. 정형 명령(`도움`)은 계속 사용할 수 있습니다.',
    }
  }

  // 일일 LLM 사용 한도.
  const usage = await checkAndIncrementUsage(args.spaceId)
  if (!usage.allowed) {
    return {
      text: `${usage.reason}\n\n정형 명령은 계속 사용할 수 있습니다. \`도움\`을 입력해보세요.`,
    }
  }

  // 대화 세션 로드 → LLM 실행 → 세션 저장 + 토큰 반영.
  const history = await loadConversation(args.channelId, args.threadTs)
  let result
  try {
    result = await runAgentLoop({
      requestedBy: args.requestedBy,
      userText: text,
      history,
    })
  } catch (err) {
    console.error('[agent] LLM 루프 에러:', err)
    return {
      text: 'AI 응답 생성 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 정형 명령(`도움`)을 사용해주세요.',
    }
  }

  await recordTokens(args.spaceId, result.usage.inputTokens, result.usage.outputTokens)
  await appendConversation({
    spaceId: args.spaceId,
    channelId: args.channelId,
    threadTs: args.threadTs,
    userText: text,
    assistantText: result.text,
  })

  return { text: result.text }
}

/**
 * 정형 명령 매칭 + 직접 실행. 매칭되면 응답 텍스트, 아니면 null(LLM 폴백).
 * ctx.userId는 requestedBy(해석된 행위 사용자) — tool 내부에서 space/workspace 재해석에 사용됨.
 */
async function tryStructuredCommand(args: RouteArgs, text: string): Promise<string | null> {
  const ctx = { userId: args.requestedBy }

  // 도움말 — 가장 먼저(다른 키워드보다 우선).
  if (/(^|\s)(도움|도움말|help|명령|명령어)(\s|$)/i.test(text)) {
    return HELP_TEXT
  }

  // 승인 — 직접 승인 금지, 웹/버튼 안내(권한 검증 경로 우회 방지).
  if (/승인\s+\S+/.test(text)) {
    return '승인은 Slack의 승인 버튼 또는 웹 승인 페이지(`/approvals`)에서 진행해주세요. 여기서는 승인을 처리하지 않습니다.'
  }

  // 상태 / KPI
  if (/상태|status|현황|kpi/i.test(text)) {
    return runTool(
      ctx,
      'ads_get_kpi',
      { startDate: daysAgoYmd(7), endDate: todayYmd() },
      formatKpi,
      'KPI를 가져올 수 없습니다.'
    )
  }

  // 캠페인 목록 (캠페인 상세보다 먼저 검사)
  if (/캠페인\s*목록|campaigns/i.test(text)) {
    return runTool(
      ctx,
      'ads_list_campaigns',
      { limit: 15 },
      formatCampaignList,
      '캠페인 목록을 가져올 수 없습니다.'
    )
  }

  // 캠페인 상세 — "캠페인 <키워드>"
  const campMatch = text.match(/캠페인\s+(\S+)/)
  if (campMatch) {
    const keyword = campMatch[1]
    if (!/목록|campaigns/i.test(keyword)) {
      return runCampaignDetail(ctx, keyword)
    }
  }

  // 비효율 키워드
  if (/비효율|낭비|inefficient/i.test(text)) {
    return runInefficient(ctx)
  }

  // 분석 실행 (write — 승인 대기 안내)
  if (/분석|analyze/i.test(text)) {
    return runTool(
      ctx,
      'ads_trigger_analysis',
      { from: daysAgoYmd(7), to: todayYmd() },
      formatPendingAction,
      '분석 실행 요청에 실패했습니다.'
    )
  }

  // 리포트
  if (/리포트|report/i.test(text)) {
    return runTool(
      ctx,
      'ads_get_latest_report',
      { limit: 1 },
      formatReport,
      '리포트를 가져올 수 없습니다.'
    )
  }

  // 태스크 — 승인 대기 목록(AgentPendingAction PENDING). 전용 read tool이 없어 직접 조회.
  if (/태스크|task/i.test(text)) {
    return listPendingActions(args.spaceId)
  }

  // 미매칭 → LLM 폴백
  return null
}

// tool 실행 + 포맷 헬퍼. deck 비활성 등 tool 에러는 그대로 사용자에게 안내.
async function runTool(
  ctx: { userId: string },
  toolName: string,
  params: Record<string, unknown>,
  formatter: (data: unknown) => string,
  fallbackMsg: string
): Promise<string> {
  const tool = getTool(toolName)
  if (!tool) return fallbackMsg
  try {
    const data = await tool.execute(ctx, params)
    return formatter(data)
  } catch (err) {
    return err instanceof Error ? `⚠️ ${err.message}` : `⚠️ ${fallbackMsg}`
  }
}

// ─── 포맷터 ──────────────────────────────────────────────────────────────────

function formatKpi(data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>
  const lines = ['*최근 7일 쿠팡 광고 KPI*']
  lines.push(`• 광고비: ${won(d.adCost ?? d.totalSpend ?? d.spend)}`)
  lines.push(`• 매출: ${won(d.revenue ?? d.totalRevenue)}`)
  const roas = d.roas
  if (typeof roas === 'number') lines.push(`• ROAS: ${roas.toFixed(1)}%`)
  const ctr = d.ctr
  if (typeof ctr === 'number') lines.push(`• CTR: ${ctr.toFixed(2)}%`)
  const cvr = d.cvr
  if (typeof cvr === 'number') lines.push(`• CVR: ${cvr.toFixed(2)}%`)
  return lines.join('\n')
}

function formatCampaignList(data: unknown): string {
  const d = (data ?? {}) as { campaigns?: unknown[]; total?: number }
  const campaigns = Array.isArray(d.campaigns) ? d.campaigns : []
  if (campaigns.length === 0) return '등록된 캠페인이 없습니다.'
  const lines = [`*캠페인 목록* (총 ${d.total ?? campaigns.length}개)`]
  for (const c of campaigns.slice(0, 15)) {
    const cc = c as Record<string, unknown>
    // queryCampaigns 반환 캠페인은 { id, name, displayName, ... } — 식별자는 id.
    const name = cc.displayName ?? cc.name ?? cc.id ?? '(이름 없음)'
    lines.push(`• ${name} \`${cc.id ?? ''}\``)
  }
  return lines.join('\n')
}

function formatReport(data: unknown): string {
  const d = (data ?? {}) as { reports?: unknown[] }
  const reports = Array.isArray(d.reports) ? d.reports : []
  if (reports.length === 0) return '분석 리포트가 없습니다.'
  const r = reports[0] as Record<string, unknown>
  const lines = ['*최근 분석 리포트*']
  if (r.status) lines.push(`• 상태: ${r.status}`)
  if (r.summary) lines.push(`\n${r.summary}`)
  return lines.join('\n')
}

// write tool(pending_approval) 결과 포맷.
function formatPendingAction(data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>
  const url = d.approvalUrl ?? buildAppUrl('/approvals')
  return [
    '승인 대기 큐에 등록했습니다. 관리자 승인 후에 실제로 실행됩니다.',
    `승인 페이지: ${url}`,
  ].join('\n')
}

// 캠페인 상세 — 이름/ID로 검색 후 상세 조회.
async function runCampaignDetail(ctx: { userId: string }, keyword: string): Promise<string> {
  const listTool = getTool('ads_list_campaigns')
  const detailTool = getTool('ads_get_campaign')
  if (!listTool || !detailTool) return '캠페인 조회를 사용할 수 없습니다.'
  try {
    const list = (await listTool.execute(ctx, { limit: 100 })) as { campaigns?: unknown[] }
    const campaigns = Array.isArray(list.campaigns) ? list.campaigns : []
    // queryCampaigns 캠페인의 식별자는 id. ID 완전 일치 우선, 없으면 이름 부분 일치.
    const lower = keyword.toLowerCase()
    const match =
      campaigns.find((c) => String((c as Record<string, unknown>).id) === keyword) ??
      campaigns.find((c) => {
        const cc = c as Record<string, unknown>
        const name = String(cc.displayName ?? cc.name ?? '').toLowerCase()
        return name.includes(lower)
      })
    if (!match) return `"${keyword}" 캠페인을 찾을 수 없습니다. \`캠페인 목록\`으로 확인해보세요.`
    const campaignId = String((match as Record<string, unknown>).id)
    const detail = (await detailTool.execute(ctx, {
      campaignId,
      from: daysAgoYmd(7),
      to: todayYmd(),
    })) as { campaign?: Record<string, unknown>; metricSeries?: unknown[] }
    // getCachedCampaignOverview 반환 = { campaign, metricSeries[], ... }.
    // 요약 지표는 metricSeries(일자별 { adCost, totalRevenue })를 합산해 산출한다.
    const mc = match as Record<string, unknown>
    const name = detail.campaign?.displayName ?? mc.displayName ?? mc.name ?? campaignId
    const lines = [`*캠페인: ${name}* \`${campaignId}\``]
    const series = Array.isArray(detail.metricSeries) ? detail.metricSeries : []
    let adCost = 0
    let revenue = 0
    for (const p of series) {
      const pp = p as Record<string, unknown>
      adCost += Number(pp.adCost ?? 0)
      revenue += Number(pp.totalRevenue ?? 0)
    }
    lines.push(`• 최근 7일 광고비: ${won(adCost)}`)
    lines.push(`• 최근 7일 매출: ${won(revenue)}`)
    if (adCost > 0) lines.push(`• ROAS: ${((revenue / adCost) * 100).toFixed(1)}%`)
    return lines.join('\n')
  } catch (err) {
    return err instanceof Error ? `⚠️ ${err.message}` : `"${keyword}" 캠페인 조회에 실패했습니다.`
  }
}

// 비효율 키워드 — 특정 캠페인 인자가 필요하므로 첫 캠페인 기준으로 조회.
async function runInefficient(ctx: { userId: string }): Promise<string> {
  const listTool = getTool('ads_list_campaigns')
  const kwTool = getTool('ads_get_inefficient_keywords')
  if (!listTool || !kwTool) return '비효율 키워드 조회를 사용할 수 없습니다.'
  try {
    const list = (await listTool.execute(ctx, { limit: 1 })) as { campaigns?: unknown[] }
    const campaigns = Array.isArray(list.campaigns) ? list.campaigns : []
    if (campaigns.length === 0) return '캠페인이 없어 비효율 키워드를 조회할 수 없습니다.'
    // queryCampaigns 캠페인 식별자는 id.
    const campaignId = String((campaigns[0] as Record<string, unknown>).id)
    const data = (await kwTool.execute(ctx, {
      campaignId,
      filter: 'zero',
      from: daysAgoYmd(7),
      to: todayYmd(),
      pageSize: 10,
    })) as Record<string, unknown>
    // queryInefficientKeywords 반환 = { items[], page, pageSize, total }.
    const rows = (data.items ?? []) as unknown[]
    if (!Array.isArray(rows) || rows.length === 0)
      return '비효율(지출 있으나 주문 0) 키워드가 없습니다.'
    const lines = ['*비효율 키워드 (지출 있으나 주문 0)*']
    for (const k of rows.slice(0, 10)) {
      const kk = k as Record<string, unknown>
      lines.push(`• ${kk.keyword ?? '-'} — 광고비 ${won(kk.adCost)}`)
    }
    return lines.join('\n')
  } catch (err) {
    return err instanceof Error ? `⚠️ ${err.message}` : '비효율 키워드를 가져올 수 없습니다.'
  }
}

// 승인 대기 목록 — AgentPendingAction PENDING(만료 전) 직접 조회.
async function listPendingActions(spaceId: string): Promise<string> {
  const now = new Date()
  const actions = await prisma.agentPendingAction.findMany({
    where: { spaceId, status: 'PENDING', expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, summary: true, actionType: true, createdAt: true },
  })
  if (actions.length === 0) return '승인 대기 중인 항목이 없습니다.'
  const lines = ['*승인 대기 목록*']
  for (const a of actions) {
    lines.push(`• ${a.summary} \`${a.id.slice(0, 8)}\``)
  }
  lines.push(
    `\n승인은 웹 승인 페이지(${buildAppUrl('/approvals')}) 또는 Slack 승인 버튼에서 진행하세요.`
  )
  return lines.join('\n')
}
