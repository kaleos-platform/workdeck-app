/**
 * 분석 자동 스케줄러
 * 매 정시 분석 스케줄을 확인하고, 조건 충족 시 분석을 트리거한다.
 */

// ─── 타입 정의 ─────────────────────────────────────────────────────────────────

import { notifyAnalysisDone } from './slack-notifier.js'

type AnalysisSchedule = {
  enabled: boolean
  intervalDays: number
  slackNotify: boolean
  lastAnalyzedAt: string | null
}

type ScheduleWithWorkspace = AnalysisSchedule & {
  workspaceId: string
}

// ─── API 헬퍼 ─────────────────────────────────────────────────────────────────

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

/** 워커 인증 헤더를 포함한 fetch 래퍼 */
async function workerFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${getBaseUrl()}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-worker-api-key': getWorkerApiKey(),
    ...(options.headers as Record<string, string> | undefined),
  }

  return fetch(url, { ...options, headers })
}

// ─── 스케줄 체크 로직 ──────────────────────────────────────────────────────────

/** 전체 활성 분석 스케줄 조회 (워커 전용 엔드포인트) */
async function fetchActiveSchedules(): Promise<ScheduleWithWorkspace[]> {
  const response = await workerFetch('/api/analysis/schedule/active')

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`활성 스케줄 조회 실패 [${response.status}]: ${body}`)
  }

  const data = await response.json()
  return data.schedules
}

/** 분석이 필요한지 판단 */
function needsAnalysis(schedule: ScheduleWithWorkspace): boolean {
  if (!schedule.enabled) return false

  // 한 번도 분석하지 않은 경우 → 즉시 실행
  if (!schedule.lastAnalyzedAt) return true

  // intervalDays 경과 여부 확인
  const lastAnalyzed = new Date(schedule.lastAnalyzedAt)
  const now = new Date()
  const diffMs = now.getTime() - lastAnalyzed.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)

  return diffDays >= schedule.intervalDays
}

/** 분석 트리거 — 최근 N일 범위로 분석 요청 */
async function triggerAnalysis(workspaceId: string, intervalDays: number): Promise<string> {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - intervalDays)

  // 날짜 포맷: YYYY-MM-DD
  const formatDate = (d: Date) => d.toISOString().split('T')[0]

  const response = await workerFetch('/api/analysis/trigger', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId,
      from: formatDate(from),
      to: formatDate(now),
      reportType: 'DAILY_REVIEW',
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`분석 트리거 실패 [${response.status}]: ${body}`)
  }

  const data = await response.json()
  return data.reportId
}

// ─── 메인 ──────────────────────────────────────────────────────────────────────

/**
 * 분석 스케줄 체크 및 실행
 * 활성 스케줄을 순회하며 조건 충족 시 분석을 트리거한다.
 */
export async function checkAndRunAnalysis(): Promise<void> {
  let schedules: ScheduleWithWorkspace[]

  try {
    schedules = await fetchActiveSchedules()
  } catch (error) {
    console.error('[analysis-scheduler] 스케줄 조회 실패:', error)
    return
  }

  console.log(`[analysis-scheduler] 활성 스케줄 ${schedules.length}개 조회됨`)

  for (const schedule of schedules) {
    if (!needsAnalysis(schedule)) {
      continue
    }

    console.log(
      `[analysis-scheduler] 분석 트리거: workspace=${schedule.workspaceId}, ` +
      `intervalDays=${schedule.intervalDays}, lastAnalyzedAt=${schedule.lastAnalyzedAt}`
    )

    try {
      const reportId = await triggerAnalysis(schedule.workspaceId, schedule.intervalDays)
      console.log(`[analysis-scheduler] 분석 시작됨: reportId=${reportId}`)

      // Slack 알림이 활성화되어 있으면 분석 완료를 대기 후 전송
      if (schedule.slackNotify) {
        waitAndNotifyAnalysis(reportId).catch((err) =>
          console.error(`[analysis-scheduler] 알림 실패:`, err)
        )
      }
    } catch (error) {
      console.error(
        `[analysis-scheduler] 분석 트리거 실패: workspace=${schedule.workspaceId}`,
        error
      )
    }
  }
}

/** 분석 완료를 폴링으로 대기 후 Slack 알림 전송 (최대 5분) */
async function waitAndNotifyAnalysis(reportId: string): Promise<void> {
  const MAX_WAIT = 5 * 60 * 1000 // 5분
  const POLL_INTERVAL = 15_000 // 15초
  const start = Date.now()

  while (Date.now() - start < MAX_WAIT) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL))

    try {
      const res = await workerFetch(`/api/analysis/reports/${reportId}`)
      if (!res.ok) continue

      const data = await res.json()
      const report = data.report

      if (report?.status === 'COMPLETED') {
        const metadata = report.metadata as { campaignCount?: number } | null
        await notifyAnalysisDone({
          summary: report.summary ?? '분석 완료',
          suggestionCount: Array.isArray(report.suggestions) ? report.suggestions.length : 0,
          campaignCount: metadata?.campaignCount ?? 0,
        })
        return
      }

      if (report?.status === 'FAILED') {
        console.log(`[analysis-scheduler] 분석 실패: ${report.summary}`)
        return
      }
    } catch {
      // 폴링 실패 시 계속 재시도
    }
  }

  console.log(`[analysis-scheduler] 분석 완료 대기 타임아웃 (${MAX_WAIT / 1000}초)`)
}
