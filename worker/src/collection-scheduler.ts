/**
 * DB 기반 수집 스케줄러
 * 매 분 활성 수집 스케줄을 확인하고, cron 시각이 일치하면 수집을 실행한다.
 */
import { getLoginCooldown } from './login-guard.js'

type CollectionSchedule = {
  workspaceId: string
  cronExpression: string
  timezone: string
}

// 오늘 이미 실행한 워크스페이스 기록 (하루 1회 보장)
const executedToday = new Set<string>()
let lastResetDate = ''

// ── 자동 재시도 ──────────────────────────────────────────────────────────────
// 예전엔 정기 수집이 일시적 실패(Akamai 봇차단·보고서 타임아웃·네트워크)로 죽어도
// executedToday 로 마킹돼 다음날까지 재시도가 없어 하루치를 통째로 잃었다. 차단은 보통
// 수시간 내 풀리므로, 로그인 쿨다운(BOT 60분)이 끝난 뒤 백오프를 두고 몇 차례 재시도한다.
// 비번 불일치(CREDENTIAL_INVALID)는 같은 자격증명으론 실패만 누적 → 재시도하지 않는다.
const MAX_RETRIES = 2 // 정기 1회 + 재시도 2회 = 하루 최대 3회 시도
const RETRY_BACKOFF_MS = 65 * 60 * 1000 // 65분 — BOT 차단 쿨다운(60분)이 끝난 뒤에 재시도되도록

// workspaceId -> { attempts: 지금까지 예약된 재시도 횟수, nextAt: 다음 시도 epoch(ms) }
const retryQueue = new Map<string, { attempts: number; nextAt: number }>()

// 동시 실행 가드 — node-cron 은 매 분 발화하지만 runCollection 은 ~9분 걸리고 tick 을
// 직렬화하지 않는다. 정기 1회차는 executedToday 가 await 전 동기 마킹돼 안전하나,
// 재시도 경로는 retryQueue 정리가 await 이후라 그 사이 다음 tick 이 같은 retryDue 를
// 보고 중복 실행한다(409·디듀프 안 되는 실패 알림·재시도 budget 오염). 진행 중인
// workspace 를 await 전 동기로 잠가 막는다(manual-poller 의 isProcessing 과 동일 패턴).
const inFlight = new Set<string>()

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
    retryQueue.clear() // 어제 예약된 재시도가 오늘로 넘어오지 않게 초기화
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
  } catch (err) {
    console.error('[collection-scheduler] 스케줄 조회 실패:', err instanceof Error ? err.message : err)
    return
  }

  if (schedules.length === 0) return

  // KST 기준 현재 시각
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  for (const schedule of schedules) {
    const ws = schedule.workspaceId
    const alreadyRan = executedToday.has(ws)
    const cronMatch = matchesCron(schedule.cronExpression, now)
    const retry = retryQueue.get(ws)
    const retryDue = retry != null && Date.now() >= retry.nextAt

    // 매 시간 정각에만 디버그 로그 (로그 과다 방지)
    if (now.getMinutes() === 0) {
      const r = retry ? `${retry.attempts}/${MAX_RETRIES}` : 'none'
      console.log(`[collection-scheduler] 체크 ${nowHHMM} — cron=${schedule.cronExpression}, match=${cronMatch}, executed=${alreadyRan}, retry=${r}`)
    }

    const isCron = cronMatch && !alreadyRan
    if (!isCron && !retryDue) continue

    // 이미 이 workspace 수집이 진행 중이면(직전 tick 의 await 미완) 재진입 차단.
    if (inFlight.has(ws)) continue

    // 쿨다운 중이면 지금 실행해도 runCollection 이 건너뛴다(no-op) → 쿨다운 종료 후로 미룬다.
    const cd = getLoginCooldown()
    if (cd.active) {
      if (isCron) executedToday.add(ws) // 크론 중복 발화 방지
      retryQueue.set(ws, { attempts: retry?.attempts ?? 0, nextAt: Date.now() + cd.remainingMs + 60_000 })
      console.log(
        `[collection-scheduler] 로그인 쿨다운 중(${cd.reason}, ~${Math.ceil(cd.remainingMs / 60000)}분) — 수집 연기: workspace=${ws}`
      )
      continue
    }

    if (isCron) {
      executedToday.add(ws)
      retryQueue.delete(ws) // 새 정기 실행 — 이전(어제 잔류 등) 재시도 상태 초기화
    }
    const label = isCron ? '시작' : `재시도(${(retry?.attempts ?? 0) + 1}/${MAX_RETRIES})`
    console.log(`[collection-scheduler] 수집 ${label}: workspace=${ws}, now=${nowHHMM}`)

    inFlight.add(ws) // await 전 동기 잠금 — 다음 tick 의 중복 실행 차단
    try {
      await runCollection('scheduled')
      console.log(`[collection-scheduler] 수집 완료: workspace=${ws}`)
      retryQueue.delete(ws) // 성공 → 재시도 취소
    } catch (err) {
      console.error(`[collection-scheduler] 수집 실패: workspace=${ws}`, err)
      scheduleRetry(ws, err)
    } finally {
      inFlight.delete(ws)
    }
  }
}

/** 실패 후 재시도 예약 — 비번오류는 제외, 최대 횟수 초과 시 종료. */
function scheduleRetry(workspaceId: string, err: unknown): void {
  // 비번 불일치는 같은 자격증명으론 실패만 누적 → 재시도 생략(운영자가 설정에서 갱신해야 함).
  const reason = (err as { reason?: string } | null)?.reason
  if (reason === 'CREDENTIAL_INVALID') {
    console.warn(
      `[collection-scheduler] 자격증명 오류 — 자동 재시도 생략(운영자 갱신 필요): workspace=${workspaceId}`
    )
    retryQueue.delete(workspaceId)
    return
  }
  const attempts = (retryQueue.get(workspaceId)?.attempts ?? 0) + 1
  if (attempts > MAX_RETRIES) {
    console.warn(
      `[collection-scheduler] 최대 재시도(${MAX_RETRIES}) 도달 — 오늘 재시도 종료: workspace=${workspaceId}`
    )
    retryQueue.delete(workspaceId)
    return
  }
  retryQueue.set(workspaceId, { attempts, nextAt: Date.now() + RETRY_BACKOFF_MS })
  console.log(
    `[collection-scheduler] 자동 재시도 예약: workspace=${workspaceId} (${attempts}/${MAX_RETRIES}, ~${Math.round(RETRY_BACKOFF_MS / 60000)}분 후)`
  )
}
