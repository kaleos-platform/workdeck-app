// Workdeck API에 heartbeat 전송 — lastActiveAt 갱신 + 설정 동기화

const BASE_URL = process.env.WORKDECK_API_URL || 'http://localhost:3000'
const API_KEY = process.env.WORKDECK_API_KEY || ''
const WORKSPACE_ID = process.env.WORKDECK_WORKSPACE_ID || ''
const HEARTBEAT_INTERVAL = 90_000 // 90초 (API 호출 67% 절감)

type HeartbeatResponse = {
  slackChannelId: string | null
  enabled: boolean
}

let currentConfig: HeartbeatResponse | null = null

export function getConfig() {
  return currentConfig
}

/** 초기 설정 로드 + 주기적 heartbeat 시작 */
export async function startHeartbeat() {
  if (!WORKSPACE_ID) {
    console.warn('WORKDECK_WORKSPACE_ID 미설정 — heartbeat 비활성화')
    return
  }

  // 초기 로드 (실패해도 에이전트는 계속 실행)
  try {
    await sendHeartbeat()
  } catch (err) {
    console.warn('초기 heartbeat 실패 (API 서버 미실행?) — .env fallback 사용:', (err as Error).message)
  }

  // 주기적 heartbeat
  setInterval(async () => {
    try {
      await sendHeartbeat()
    } catch (err) {
      console.error('Heartbeat 실패:', err)
    }
  }, HEARTBEAT_INTERVAL)

  console.log(`Heartbeat 시작 (${HEARTBEAT_INTERVAL / 1000}초 간격)`)
}

async function sendHeartbeat() {
  const res = await fetch(`${BASE_URL}/api/deck-agents/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-api-key': API_KEY,
    },
    body: JSON.stringify({ workspaceId: WORKSPACE_ID }),
    signal: AbortSignal.timeout(5000),
  })

  if (!res.ok) {
    console.error(`Heartbeat HTTP ${res.status}`)
    return
  }

  currentConfig = await res.json()
}
