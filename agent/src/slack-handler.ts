import type { App } from '@slack/bolt'
import * as api from './workdeck-client'
import { formatResponse } from './response-formatter'

// Slack 메시지 핸들러 등록
export function registerHandlers(app: App) {
  app.message(/상태|status/i, async ({ say }) => {
    const data = await api.get('/api/dashboard/kpi')
    await say(formatResponse('KPI 현황', data))
  })

  app.message(/분석|analyze/i, async ({ say }) => {
    const data = await api.post('/api/analysis/trigger', {
      startDate: getDateDaysAgo(7),
      endDate: getToday(),
    })
    await say(formatResponse('분석 실행', data))
  })

  app.message(/리포트|report/i, async ({ say }) => {
    const data = await api.get('/api/analysis/reports')
    await say(formatResponse('분석 리포트', data))
  })

  app.message(/태스크|tasks/i, async ({ say }) => {
    const data = await api.get('/api/execution/tasks')
    await say(formatResponse('실행 태스크', data))
  })

  app.message(/승인\s+(\S+)/i, async ({ say, context }) => {
    const match = context.matches as RegExpMatchArray
    const taskId = match?.[1]
    if (!taskId) {
      await say('승인할 태스크 ID를 입력해주세요. 예: 승인 clxxx...')
      return
    }
    const data = await api.patch(`/api/execution/tasks/${taskId}`, {
      action: 'approve',
    })
    await say(formatResponse('태스크 승인', data))
  })

  // ─── 분석 규칙 관리 핸들러 ──────────────────────────────────────────────────

  // 규칙 추가: <텍스트>
  app.message(/규칙\s*추가[:\s]+(.+)/i, async ({ say, context }) => {
    const match = context.matches as RegExpMatchArray
    const ruleText = match?.[1]?.trim()
    if (!ruleText) {
      await say('추가할 규칙 내용을 입력해주세요. 예: 규칙 추가: CTR 0.3% 미만 키워드 제거')
      return
    }
    const data = await api.post('/api/analysis/rules', {
      rule: ruleText,
      source: 'user',
    })
    await say(formatResponse('규칙 추가', data))
  })

  // 규칙 목록
  app.message(/규칙\s*목록/i, async ({ say }) => {
    const data = await api.get('/api/analysis/rules')
    await say(formatResponse('분석 규칙 목록', data))
  })

  // 규칙 삭제 <id>
  app.message(/규칙\s*삭제\s+(\S+)/i, async ({ say, context }) => {
    const match = context.matches as RegExpMatchArray
    const ruleId = match?.[1]?.trim()
    if (!ruleId) {
      await say('삭제할 규칙 ID를 입력해주세요. 예: 규칙 삭제 clxxx...')
      return
    }
    const data = await api.del(`/api/analysis/rules/${ruleId}`)
    await say(formatResponse('규칙 삭제', data))
  })
}

// 유틸리티
function getToday(): string {
  return new Date().toISOString().split('T')[0]
}

function getDateDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}
