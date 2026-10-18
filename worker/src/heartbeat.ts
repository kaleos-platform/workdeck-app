/**
 * Workdeck API에 워커 heartbeat 전송.
 * Vercel cron(/api/cron/inventory-stale-check)이 이 핑을 보고 워커 다운을
 * 감지하여 Slack 알림한다.
 */

const BASE_URL = process.env.WORKDECK_API_URL || 'http://localhost:3000'
const API_KEY = process.env.WORKER_API_KEY || ''
export const HEARTBEAT_INTERVAL_MS = 120_000 // 2분

// service 별로 따로 감시된다(cron/inventory-stale-check 의 WORKER_SERVICES).
export function startWorkerHeartbeat(service = 'inventory-collector', baseUrl = BASE_URL) {
  if (!API_KEY) {
    console.warn('[heartbeat] WORKER_API_KEY 미설정 — heartbeat 비활성화')
    return
  }

  // 즉시 1회 발송
  void sendHeartbeat(service, baseUrl)

  setInterval(() => {
    void sendHeartbeat(service, baseUrl)
  }, HEARTBEAT_INTERVAL_MS)

  console.log(`[heartbeat] 시작 (service=${service}, ${HEARTBEAT_INTERVAL_MS / 1000}초 간격)`)
}

async function sendHeartbeat(service: string, baseUrl: string) {
  try {
    const res = await fetch(`${baseUrl}/api/worker/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-api-key': API_KEY,
      },
      body: JSON.stringify({
        service,
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
