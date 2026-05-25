/**
 * Workdeck API에 워커 heartbeat 전송.
 * Vercel cron(/api/cron/inventory-stale-check)이 이 핑을 보고 워커 다운을
 * 감지하여 Slack 알림한다.
 */

const BASE_URL = process.env.WORKDECK_API_URL || 'http://localhost:3000'
const API_KEY = process.env.WORKER_API_KEY || ''
const SERVICE = 'inventory-collector'
const HEARTBEAT_INTERVAL_MS = 60_000 // 1분

export function startWorkerHeartbeat() {
  if (!API_KEY) {
    console.warn('[heartbeat] WORKER_API_KEY 미설정 — heartbeat 비활성화')
    return
  }

  // 즉시 1회 발송
  void sendHeartbeat()

  setInterval(() => {
    void sendHeartbeat()
  }, HEARTBEAT_INTERVAL_MS)

  console.log(`[heartbeat] 시작 (service=${SERVICE}, ${HEARTBEAT_INTERVAL_MS / 1000}초 간격)`)
}

async function sendHeartbeat() {
  try {
    const res = await fetch(`${BASE_URL}/api/worker/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-api-key': API_KEY,
      },
      body: JSON.stringify({
        service: SERVICE,
        metadata: {
          pid: process.pid,
          nodeVersion: process.version,
          uptimeSec: Math.floor(process.uptime()),
        },
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      console.error(`[heartbeat] HTTP ${res.status}`)
    }
  } catch (err) {
    console.error('[heartbeat] 발송 실패:', (err as Error).message)
  }
}
