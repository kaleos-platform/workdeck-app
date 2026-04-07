/**
 * 분석 폴링 모듈
 * 30초마다 PENDING 상태의 분석 리포트를 확인하고 실행한다.
 * 완료 후 Slack 알림을 발송한다.
 */

import { notifyAnalysisDone } from './slack-notifier.js'

const POLL_INTERVAL = 30_000 // 30초
let isProcessing = false

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

async function workerFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${getBaseUrl()}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-worker-api-key': getWorkerApiKey(),
    ...(options.headers as Record<string, string> | undefined),
  }

  return fetch(url, { ...options, headers })
}

export function startAnalysisPoller(): void {
  setInterval(async () => {
    if (isProcessing) return

    try {
      const res = await workerFetch('/api/analysis/reports/pending')
      if (!res.ok) return

      const data = await res.json()
      if (!data.report) return

      const report = data.report as { id: string }
      console.log(`\n[analysis-poller] PENDING 분석 발견: ${report.id}`)
      isProcessing = true

      try {
        // 분석 실행 (동기 — 서버에서 완료될 때까지 대기)
        const runRes = await workerFetch(`/api/analysis/reports/${report.id}/run`, {
          method: 'POST',
        })

        if (!runRes.ok) {
          const body = await runRes.text().catch(() => '')
          console.error(`[analysis-poller] 분석 API 에러 [${runRes.status}]: ${body.slice(0, 200)}`)
          return
        }

        const result = await runRes.json() as {
          status: string
          summary?: string
          suggestionCount?: number
          campaignCount?: number
          error?: string
        }

        if (result.status === 'COMPLETED') {
          console.log(`[analysis-poller] 분석 완료: ${report.id}`)

          // Slack 알림 발송
          await notifyAnalysisDone({
            summary: result.summary ?? '분석 완료',
            suggestionCount: result.suggestionCount ?? 0,
            campaignCount: result.campaignCount ?? 0,
          })
        } else {
          console.log(`[analysis-poller] 분석 실패: ${report.id} — ${result.error ?? '알 수 없는 오류'}`)
        }
      } catch (err) {
        console.error(`[analysis-poller] 분석 실행 에러: ${report.id}`, err)
      } finally {
        isProcessing = false
      }
    } catch {
      // API 서버 미실행 등 — 조용히 무시
    }
  }, POLL_INTERVAL)

  console.log(`분석 폴링 시작 (${POLL_INTERVAL / 1000}초 간격)`)
}
