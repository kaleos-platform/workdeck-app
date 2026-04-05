import type { KnownBlock, SectionBlock, HeaderBlock, DividerBlock, ContextBlock } from '@slack/bolt'

// ─── Block Kit 포맷터 ───────────────────────────────────────────────────────

/** KPI 현황 카드 */
export function formatKpi(data: {
  totalSpend?: number
  totalRevenue?: number
  roas?: number
  impressions?: number
  clicks?: number
  ctr?: number
  campaigns?: number
}) {
  const blocks: KnownBlock[] = [
    header(':bar_chart: KPI 현황'),
    divider(),
    section(
      `*총 광고비*\n${won(data.totalSpend)}`,
      `*총 매출*\n${won(data.totalRevenue)}`,
    ),
    section(
      `*ROAS*\n${pct(data.roas)}`,
      `*CTR*\n${pct(data.ctr)}`,
    ),
    section(
      `*노출수*\n${num(data.impressions)}`,
      `*클릭수*\n${num(data.clicks)}`,
    ),
    context(`캠페인 ${data.campaigns ?? '-'}개 기준`),
  ]
  return { blocks }
}

/** 분석 리포트 카드 */
export function formatReport(data: {
  id?: string
  status?: string
  summary?: string
  inefficientCount?: number
  potentialSaving?: number
  createdAt?: string
}) {
  const blocks: KnownBlock[] = [
    header(':mag: 분석 리포트'),
    divider(),
    section(`*상태:* ${statusEmoji(data.status)} ${data.status ?? '-'}`),
    section(data.summary ?? '분석 결과가 없습니다.'),
    section(
      `*비효율 키워드*\n${num(data.inefficientCount)}개`,
      `*절감 가능 금액*\n${won(data.potentialSaving)}`,
    ),
    context(data.createdAt ? `생성: ${data.createdAt}` : ''),
  ]
  return { blocks }
}

/** 태스크 목록 카드 */
export function formatTasks(tasks: Array<{
  id: string
  title: string
  status: string
  type?: string
}>) {
  if (!tasks?.length) {
    return { blocks: [header(':clipboard: 실행 태스크'), divider(), section('등록된 태스크가 없습니다.')] }
  }

  const lines = tasks.slice(0, 10).map(
    (t) => `${statusEmoji(t.status)} \`${t.id.slice(0, 8)}\` ${t.title}`,
  )

  const blocks: KnownBlock[] = [
    header(':clipboard: 실행 태스크'),
    divider(),
    section(lines.join('\n')),
  ]

  if (tasks.length > 10) {
    blocks.push(context(`외 ${tasks.length - 10}건 더 있음`))
  }
  return { blocks }
}

/** 태스크 승인 결과 */
export function formatApproval(data: { id?: string; title?: string; status?: string }) {
  return {
    blocks: [
      header(':white_check_mark: 태스크 승인'),
      divider(),
      section(`\`${data.id?.slice(0, 8) ?? '-'}\` *${data.title ?? '-'}*\n상태: ${statusEmoji(data.status)} ${data.status ?? '-'}`),
    ],
  }
}

/** 분석 규칙 목록 */
export function formatRules(rules: Array<{ id: string; rule: string; source?: string }>) {
  if (!rules?.length) {
    return { blocks: [header(':gear: 분석 규칙'), divider(), section('등록된 규칙이 없습니다.')] }
  }

  const lines = rules.map(
    (r) => `:small_blue_diamond: \`${r.id.slice(0, 8)}\` ${r.rule} _(${r.source ?? 'system'})_`,
  )

  return {
    blocks: [
      header(':gear: 분석 규칙'),
      divider(),
      section(lines.join('\n')),
    ],
  }
}

/** 규칙 추가/삭제 결과 */
export function formatRuleAction(action: '추가' | '삭제', data: { id?: string; rule?: string }) {
  const emoji = action === '추가' ? ':heavy_plus_sign:' : ':heavy_minus_sign:'
  return {
    blocks: [
      header(`${emoji} 규칙 ${action}`),
      divider(),
      section(`\`${data.id?.slice(0, 8) ?? '-'}\` ${data.rule ?? '완료'}`),
    ],
  }
}

/** 자동 알림: 수집 완료 */
export function formatCollectionDone(data: {
  recordCount?: number
  dateRange?: string
  campaignCount?: number
}) {
  return {
    blocks: [
      header(':inbox_tray: 데이터 수집 완료'),
      divider(),
      section(
        `*수집 레코드*\n${num(data.recordCount)}건`,
        `*캠페인*\n${num(data.campaignCount)}개`,
      ),
      context(data.dateRange ? `기간: ${data.dateRange}` : ''),
    ],
  }
}

/** 자동 알림: 분석 완료 */
export function formatAnalysisDone(data: {
  summary?: string
  suggestions?: string[]
  inefficientCount?: number
  potentialSaving?: number
}) {
  const blocks: KnownBlock[] = [
    header(':sparkles: 분석 완료 — 제안 사항'),
    divider(),
    section(data.summary ?? '분석이 완료되었습니다.'),
  ]

  if (data.suggestions?.length) {
    const lines = data.suggestions.slice(0, 5).map((s) => `:bulb: ${s}`)
    blocks.push(section(lines.join('\n')))
  }

  blocks.push(
    section(
      `*비효율 키워드*\n${num(data.inefficientCount)}개`,
      `*절감 가능*\n${won(data.potentialSaving)}`,
    ),
  )

  return { blocks }
}

/** 에러 메시지 */
export function formatError(message: string) {
  return {
    blocks: [
      section(`:warning: ${message}`),
    ],
  }
}

/** 일반 텍스트 (fallback) */
export function formatText(title: string, data: unknown): string {
  const json = JSON.stringify(data, null, 2)
  const truncated = json.length > 2500 ? json.slice(0, 2500) + '\n...(생략)' : json
  return `*${title}*\n\`\`\`${truncated}\`\`\``
}

// ─── 블록 헬퍼 ─────────────────────────────────────────────────────────────

function header(text: string): HeaderBlock {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } }
}

function divider(): DividerBlock {
  return { type: 'divider' }
}

function section(text: string, accessoryText?: string): SectionBlock {
  if (accessoryText) {
    return {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text },
        { type: 'mrkdwn', text: accessoryText },
      ],
    }
  }
  return { type: 'section', text: { type: 'mrkdwn', text } }
}

function context(text: string): ContextBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] }
}

// ─── 값 포맷 헬퍼 ──────────────────────────────────────────────────────────

function won(v?: number): string {
  if (v == null) return '-'
  return `${v.toLocaleString('ko-KR')}원`
}

function pct(v?: number): string {
  if (v == null) return '-'
  return `${v.toFixed(1)}%`
}

function num(v?: number): string {
  if (v == null) return '-'
  return v.toLocaleString('ko-KR')
}

function statusEmoji(status?: string): string {
  switch (status?.toLowerCase()) {
    case 'completed':
    case 'done':
    case 'approved':
      return ':white_check_mark:'
    case 'pending':
    case 'waiting':
      return ':hourglass_flowing_sand:'
    case 'running':
    case 'in_progress':
      return ':arrows_counterclockwise:'
    case 'failed':
    case 'error':
      return ':x:'
    default:
      return ':black_small_square:'
  }
}
