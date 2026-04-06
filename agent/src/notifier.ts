import type { App } from '@slack/bolt'
import * as api from './workdeck-client'
import { getConfig } from './heartbeat'
import { logActivity } from './logger'
import { formatCollectionDone, formatAnalysisDone } from './response-formatter'

/** DB 설정 → .env fallback 순으로 채널 ID 반환 */
function getChannel(): string {
  return getConfig()?.slackChannelId || process.env.SLACK_CHANNEL_ID || ''
}

/** 주기적으로 워크덱 API를 폴링하여 완료된 작업을 Slack에 알림 */
export function startNotifier(app: App) {
  const POLL_INTERVAL = 60_000 // 1분

  let lastChecked = new Date().toISOString()

  setInterval(async () => {
    try {
      await checkCollections(app, lastChecked)
      await checkAnalysis(app, lastChecked)
      lastChecked = new Date().toISOString()
    } catch (err) {
      console.error('Notifier poll error:', err)
    }
  }, POLL_INTERVAL)

  console.log(`알림 폴링 시작 (${POLL_INTERVAL / 1000}초 간격)`)
}

async function checkCollections(app: App, since: string) {
  const res = await api.get(`/api/collection/events?since=${since}`)
  if (!res?.events?.length) return

  for (const event of res.events) {
    if (event.type === 'collection_done') {
      // KPI 데이터도 함께 가져와서 수집 완료 + KPI 요약으로 전송
      let kpi: { totalSpend?: number; totalRevenue?: number; roas?: number; ctr?: number } | undefined
      try {
        const kpiRes = await api.get('/api/dashboard/kpi')
        if (kpiRes && !kpiRes.error) kpi = kpiRes
      } catch {
        // KPI 조회 실패해도 수집 알림은 전송
      }

      await app.client.chat.postMessage({
        channel: getChannel(),
        ...formatCollectionDone({
          recordCount: event.recordCount,
          dateRange: event.dateRange,
          campaignCount: event.campaignCount,
          kpi,
        }),
        text: `데이터 수집 완료: ${event.recordCount ?? 0}건`,
      })
      logActivity({ type: 'notification', command: '수집 완료 알림', response: `${event.recordCount ?? 0}건 수집` })
    }
  }
}

async function checkAnalysis(app: App, since: string) {
  const res = await api.get(`/api/analysis/events?since=${since}`)
  if (!res?.events?.length) return

  for (const event of res.events) {
    if (event.type === 'analysis_done') {
      await app.client.chat.postMessage({
        channel: getChannel(),
        ...formatAnalysisDone({
          summary: event.summary,
          suggestions: event.suggestions,
          inefficientCount: event.inefficientCount,
          potentialSaving: event.potentialSaving,
        }),
        text: `분석 완료: ${event.summary ?? ''}`,
      })
      logActivity({ type: 'notification', command: '분석 완료 알림', response: event.summary ?? '' })
    }
  }
}

/** 외부에서 직접 호출하여 알림 전송 */
export async function notify(app: App, message: { blocks: unknown[]; text: string }) {
  await app.client.chat.postMessage({
    channel: getChannel(),
    ...message,
  })
}
