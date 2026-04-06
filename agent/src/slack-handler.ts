import type { App } from '@slack/bolt'
import * as api from './workdeck-client'
import { logActivity } from './logger'
import {
  formatKpi,
  formatReport,
  formatTasks,
  formatApproval,
  formatRules,
  formatRuleAction,
  formatError,
  formatText,
} from './response-formatter'

const WORKDECK_URL = process.env.WORKDECK_API_URL || 'http://localhost:3000'

export function registerHandlers(app: App) {
  // ─── KPI / 상태 ───────────────────────────────────────────────────────

  app.message(/상태|status|현황|kpi/i, async ({ say }) => {
    try {
      const data = await api.get('/api/dashboard/kpi')
      await say(formatKpi(data))
      logActivity({ type: 'command', command: 'KPI 현황', response: 'KPI 데이터 전송' })
    } catch {
      await say(formatError('KPI 데이터를 가져올 수 없습니다.'))
      logActivity({ type: 'error', command: 'KPI 현황', response: 'KPI 조회 실패' })
    }
  })

  // ─── 캠페인 목록 ─────────────────────────────────────────────────────

  app.message(/캠페인\s*목록|campaigns/i, async ({ say }) => {
    try {
      const data = await api.get('/api/campaigns')
      if (!data?.campaigns?.length) {
        await say(formatError('등록된 캠페인이 없습니다.'))
        return
      }
      const lines = data.campaigns.slice(0, 10).map(
        (c: { id: string; name: string; status: string }) =>
          `:small_blue_diamond: *${c.name}* — ${c.status}\n<${WORKDECK_URL}/dashboard/campaigns/${c.id}|상세 보기>`,
      )
      await say({
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: ':mega: 캠페인 목록', emoji: true } },
          { type: 'divider' },
          { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n\n') } },
        ],
      })
    } catch {
      await say(formatError('캠페인 목록을 가져올 수 없습니다.'))
    }
  })

  // ─── 캠페인 상세 ─────────────────────────────────────────────────────

  app.message(/캠페인\s+(\S+)/i, async ({ say, context }) => {
    const match = context.matches as RegExpMatchArray
    const keyword = match?.[1]
    if (!keyword || /목록|campaigns/i.test(keyword)) return

    try {
      const data = await api.get(`/api/campaigns/search?q=${encodeURIComponent(keyword)}`)
      if (!data?.campaign) {
        await say(formatError(`"${keyword}" 캠페인을 찾을 수 없습니다.`))
        return
      }
      const c = data.campaign
      await say({
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: `:mega: ${c.name}`, emoji: true } },
          { type: 'divider' },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*광고비*\n${(c.spend ?? 0).toLocaleString('ko-KR')}원` },
              { type: 'mrkdwn', text: `*매출*\n${(c.revenue ?? 0).toLocaleString('ko-KR')}원` },
            ],
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*ROAS*\n${(c.roas ?? 0).toFixed(1)}%` },
              { type: 'mrkdwn', text: `*CTR*\n${(c.ctr ?? 0).toFixed(2)}%` },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `<${WORKDECK_URL}/dashboard/campaigns/${c.id}|:link: 워크덱에서 보기>`,
            },
          },
        ],
      })
    } catch {
      await say(formatError(`"${keyword}" 캠페인 조회에 실패했습니다.`))
    }
  })

  // ─── 비효율 키워드 ───────────────────────────────────────────────────

  app.message(/비효율|낭비|inefficient/i, async ({ say }) => {
    logActivity({ type: 'command', command: '비효율 키워드', response: '조회 시작' })
    try {
      const data = await api.get('/api/analysis/inefficient-keywords')
      if (!data?.keywords?.length) {
        await say(formatError('비효율 키워드가 없습니다.'))
        return
      }
      const lines = data.keywords.slice(0, 10).map(
        (k: { keyword: string; spend: number; roas: number }) =>
          `:red_circle: *${k.keyword}* — 광고비 ${k.spend.toLocaleString('ko-KR')}원, ROAS ${k.roas.toFixed(1)}%`,
      )
      await say({
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: ':warning: 비효율 키워드 TOP 10', emoji: true } },
          { type: 'divider' },
          { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `총 ${data.keywords.length}개 | 절감 가능: ${(data.totalSaving ?? 0).toLocaleString('ko-KR')}원` }],
          },
        ],
      })
    } catch {
      await say(formatError('비효율 키워드를 가져올 수 없습니다.'))
    }
  })

  // ─── 분석 실행 ───────────────────────────────────────────────────────

  app.message(/분석|analyze/i, async ({ say }) => {
    try {
      const data = await api.post('/api/analysis/trigger', {
        startDate: getDateDaysAgo(7),
        endDate: getToday(),
      })
      await say(formatReport(data))
      logActivity({ type: 'command', command: '분석 실행', response: '7일간 분석 트리거' })
    } catch {
      await say(formatError('분석 실행에 실패했습니다.'))
      logActivity({ type: 'error', command: '분석 실행', response: '분석 트리거 실패' })
    }
  })

  // ─── 리포트 조회 ─────────────────────────────────────────────────────

  app.message(/리포트|report/i, async ({ say }) => {
    try {
      const data = await api.get('/api/analysis/reports')
      if (data?.reports?.length) {
        await say(formatReport(data.reports[0]))
      } else {
        await say(formatError('리포트가 없습니다.'))
      }
    } catch {
      await say(formatError('리포트를 가져올 수 없습니다.'))
    }
  })

  // ─── 태스크 목록 ─────────────────────────────────────────────────────

  app.message(/태스크|tasks/i, async ({ say }) => {
    try {
      const data = await api.get('/api/execution/tasks')
      await say(formatTasks(data?.tasks ?? []))
    } catch {
      await say(formatError('태스크를 가져올 수 없습니다.'))
    }
  })

  // ─── 태스크 승인 ─────────────────────────────────────────────────────

  app.message(/승인\s+(\S+)/i, async ({ say, context }) => {
    const match = context.matches as RegExpMatchArray
    const taskId = match?.[1]
    if (!taskId) {
      await say('승인할 태스크 ID를 입력해주세요. 예: `승인 clxxx...`')
      return
    }
    try {
      const data = await api.patch(`/api/execution/tasks/${taskId}`, {
        action: 'approve',
      })
      await say(formatApproval(data))
    } catch {
      await say(formatError(`태스크 \`${taskId}\` 승인에 실패했습니다.`))
    }
  })

  // ─── 분석 규칙 관리 ──────────────────────────────────────────────────

  app.message(/규칙\s*추가[:\s]+(.+)/i, async ({ say, context }) => {
    const match = context.matches as RegExpMatchArray
    const ruleText = match?.[1]?.trim()
    if (!ruleText) {
      await say('추가할 규칙 내용을 입력해주세요. 예: `규칙 추가: CTR 0.3% 미만 키워드 제거`')
      return
    }
    try {
      const data = await api.post('/api/analysis/rules', { rule: ruleText, source: 'user' })
      await say(formatRuleAction('추가', data))
    } catch {
      await say(formatError('규칙 추가에 실패했습니다.'))
    }
  })

  app.message(/규칙\s*목록/i, async ({ say }) => {
    try {
      const data = await api.get('/api/analysis/rules')
      await say(formatRules(data?.rules ?? []))
    } catch {
      await say(formatError('규칙 목록을 가져올 수 없습니다.'))
    }
  })

  app.message(/규칙\s*삭제\s+(\S+)/i, async ({ say, context }) => {
    const match = context.matches as RegExpMatchArray
    const ruleId = match?.[1]?.trim()
    if (!ruleId) {
      await say('삭제할 규칙 ID를 입력해주세요. 예: `규칙 삭제 clxxx...`')
      return
    }
    try {
      const data = await api.del(`/api/analysis/rules/${ruleId}`)
      await say(formatRuleAction('삭제', data))
    } catch {
      await say(formatError('규칙 삭제에 실패했습니다.'))
    }
  })

  // ─── 도움말 ──────────────────────────────────────────────────────────

  app.message(/도움|help|명령/i, async ({ say }) => {
    await say({
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: ':robot_face: 에밀리 명령어 안내', emoji: true } },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              ':bar_chart: `상태` / `KPI` — 전체 KPI 현황',
              ':mega: `캠페인 목록` — 캠페인 리스트',
              ':mega: `캠페인 <이름>` — 캠페인 상세 조회',
              ':warning: `비효율` — 비효율 키워드 TOP 10',
              ':mag: `분석` — 최근 7일 분석 실행',
              ':page_facing_up: `리포트` — 최근 분석 리포트',
              ':clipboard: `태스크` — 실행 태스크 목록',
              ':white_check_mark: `승인 <ID>` — 태스크 승인',
              ':gear: `규칙 목록` / `규칙 추가: <내용>` / `규칙 삭제 <ID>`',
            ].join('\n'),
          },
        },
      ],
    })
  })
}

// ─── 유틸리티 ────────────────────────────────────────────────────────────────

function getToday(): string {
  return new Date().toISOString().split('T')[0]
}

function getDateDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}
