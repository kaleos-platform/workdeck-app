/**
 * DB 기반 수집 스케줄러
 * 매 분 활성 수집 스케줄을 확인하고, cron 시각이 일치하면 수집을 실행한다.
 */

type CollectionSchedule = {
  workspaceId: string
  cronExpression: string
  timezone: string
}

// 오늘 이미 실행한 워크스페이스 기록 (하루 1회 보장)
const executedToday = new Set<string>()
let lastResetDate = ''

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

/** 활성 수집 스케줄 조회 */
async function fetchActiveSchedules(): Promise<CollectionSchedule[]> {
  const res = await fetch(`${getBaseUrl()}/api/collection/schedule/active`, {
    headers: { 'x-worker-api-key': getWorkerApiKey() },
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.schedules ?? []
}

/** cron "분 시 * * *" 패턴이 현재 시각과 일치하는지 확인 */
function matchesCron(cronExpression: string, now: Date): boolean {
  const parts = cronExpression.split(' ')
  if (parts.length < 5) return false

  const cronMinute = parseInt(parts[0], 10)
  const cronHour = parseInt(parts[1], 10)
  if (isNaN(cronMinute) || isNaN(cronHour)) return false

  return now.getHours() === cronHour && now.getMinutes() === cronMinute
}

/** 날짜 리셋 (자정이 지나면 executedToday 초기화) */
function resetIfNewDay() {
  const today = new Date().toISOString().split('T')[0]
  if (today !== lastResetDate) {
    executedToday.clear()
    lastResetDate = today
  }
}

/** 매 분 실행 — 스케줄 체크 + 수집 트리거 */
export async function checkAndRunCollection(
  runCollection: (triggeredBy: string) => Promise<void>,
): Promise<void> {
  resetIfNewDay()

  let schedules: CollectionSchedule[]
  try {
    schedules = await fetchActiveSchedules()
  } catch {
    return // API 미실행 시 무시
  }

  if (schedules.length === 0) return

  // KST 기준 현재 시각
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))

  for (const schedule of schedules) {
    if (executedToday.has(schedule.workspaceId)) continue
    if (!matchesCron(schedule.cronExpression, now)) continue

    console.log(`[collection-scheduler] 수집 시작: workspace=${schedule.workspaceId}, cron=${schedule.cronExpression}`)
    executedToday.add(schedule.workspaceId)

    try {
      await runCollection('scheduled')
      console.log(`[collection-scheduler] 수집 완료: workspace=${schedule.workspaceId}`)
    } catch (err) {
      console.error(`[collection-scheduler] 수집 실패: workspace=${schedule.workspaceId}`, err)
    }
  }
}
