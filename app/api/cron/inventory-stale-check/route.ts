import { prisma } from '@/lib/prisma'
import { notifyInventoryStaleData, notifyWorkerDown } from '@/lib/slack-inventory-notifier'
import { withCronRun } from '@/lib/cron/with-cron-run'

export const runtime = 'nodejs'

const STALE_THRESHOLD_DAYS = 2
const WORKER_HEARTBEAT_THRESHOLD_MIN = 10 // 10분 이상 ping 없으면 다운으로 간주
/** stale 재알림 간격 — cron 이 24시간 주기라 하루 1회 발송이 된다. */
const STALE_RENOTIFY_WINDOW_MS = 20 * 60 * 60 * 1000
const WORKER_SERVICE = 'inventory-collector'

function kstMidnight(d: Date): Date {
  const kst = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  kst.setHours(0, 0, 0, 0)
  return kst
}

/**
 * GET /api/cron/inventory-stale-check — Vercel cron 호출 전용.
 *
 * 워커 호스트가 죽어 있어도 prod에서 매일 자동으로 stale 상태를 확인하고
 * Slack에 알림을 보내는 안전망. 같은 (workspaceId, snapshotDate) 조합에는
 * `triggeredBy='stale-skip'` marker로 dedupe된다.
 *
 * Vercel cron 인증(`Authorization: Bearer ${CRON_SECRET}`)과 실행 이력 기록은
 * `withCronRun`이 담당한다.
 */
export const GET = withCronRun('/api/cron/inventory-stale-check', async () => {
  // 모든 워크스페이스의 최신 INVENTORY_HEALTH snapshotDate 조회
  const latestPerWorkspace = await prisma.$queryRaw<
    Array<{ workspaceId: string; snapshotDate: Date }>
  >`
    SELECT DISTINCT ON ("workspaceId") "workspaceId", "snapshotDate"
    FROM "InventoryUpload"
    WHERE "fileType" = 'INVENTORY_HEALTH'
    ORDER BY "workspaceId", "snapshotDate" DESC
  `

  const today = kstMidnight(new Date())
  const checked: Array<{
    workspaceId: string
    ageDays: number
    stale: boolean
    notified: boolean
  }> = []

  for (const row of latestPerWorkspace) {
    const ageDays = Math.floor(
      (today.getTime() - kstMidnight(row.snapshotDate).getTime()) / 86_400_000
    )
    const stale = ageDays >= STALE_THRESHOLD_DAYS

    let notified = false
    if (stale) {
      // dedupe — 하루 1회만 알린다.
      //
      // 예전엔 (workspaceId, snapshotDate) 조합에 marker 가 하나라도 있으면 skip 했다.
      // 그러면 데이터가 오래될수록 조용해진다 — 스냅샷이 안 바뀌니 첫 알림 이후로는
      // 영원히 dedupe 에 걸린다. 2026-08-30 에 마커가 찍힌 뒤 08-31·09-01·09-02 실행이
      // 전부 스킵돼, 재고 데이터가 6일 비어 있는 동안 알림이 한 번도 안 갔다.
      // 오래된 데이터일수록 더 시끄러워야 하는데 정반대로 동작했다.
      //
      // 그래서 "이 스냅샷에 대해 최근 20시간 안에 이미 알렸는가"로 바꾼다. cron 이 24시간
      // 간격이라 매 실행마다 정확히 1회 발송된다. KST 자정 기준이 아니라 롤링 윈도우인
      // 이유는 위 kstMidnight 이 날짜 차이 계산용이라(양쪽 같은 변환이라 상쇄된다)
      // timestamp 직접 비교에는 9시간 어긋나기 때문이다. 아래 heartbeat dedupe 도 같은
      // 롤링 윈도우 방식이라 일관적이다.
      const dedupeWindowStart = new Date(Date.now() - STALE_RENOTIFY_WINDOW_MS)
      const existing = await prisma.inventoryAnalysis.findFirst({
        where: {
          workspaceId: row.workspaceId,
          snapshotDate: row.snapshotDate,
          triggeredBy: 'stale-skip',
          analysedAt: { gte: dedupeWindowStart },
        },
        select: { id: true },
      })

      if (!existing) {
        try {
          // 반환값이 실제 발송 성공 여부 — Deck 알림 토글 off면 false(미발송).
          notified = await notifyInventoryStaleData({
            workspaceId: row.workspaceId,
            snapshotDate: row.snapshotDate,
            ageDays,
          })
        } catch (err) {
          console.error(`[cron/inventory-stale-check] Slack 실패 (${row.workspaceId}):`, err)
        }

        // Slack 전송 성공 시에만 dedupe 마커 기록.
        // 미발송(실패·토글 off) 시 마커 없음 → 다음 cron 실행에서 재평가(영구 침묵 방지).
        if (notified) {
          await prisma.inventoryAnalysis.create({
            data: {
              workspaceId: row.workspaceId,
              snapshotDate: row.snapshotDate,
              triggeredBy: 'stale-skip',
              results: {} as object,
              shortageCount: 0,
              returnRateCount: 0,
              storageFeeCount: 0,
              winnerIssueCount: 0,
            },
          })
        }
      }
    }

    checked.push({ workspaceId: row.workspaceId, ageDays, stale, notified })
  }

  // 워커 heartbeat 체크 — 마지막 ping이 임계치 이전이면 Slack 알림
  // dedupe: metadata.lastNotifiedAt이 12시간 이내면 재발송 생략
  let workerCheck: {
    service: string
    lastPingAt: string | null
    minutesSincePing: number | null
    down: boolean
    notified: boolean
  } = {
    service: WORKER_SERVICE,
    lastPingAt: null,
    minutesSincePing: null,
    down: false,
    notified: false,
  }

  try {
    const heartbeat = await prisma.workerHeartbeat.findUnique({
      where: { service: WORKER_SERVICE },
    })

    const lastPingAt = heartbeat?.lastPingAt ?? null
    const minutesSincePing = lastPingAt
      ? Math.floor((Date.now() - lastPingAt.getTime()) / 60_000)
      : null
    const down = minutesSincePing === null || minutesSincePing >= WORKER_HEARTBEAT_THRESHOLD_MIN

    workerCheck = {
      service: WORKER_SERVICE,
      lastPingAt: lastPingAt?.toISOString() ?? null,
      minutesSincePing,
      down,
      notified: false,
    }

    if (down) {
      const meta = (heartbeat?.metadata ?? {}) as { lastNotifiedAt?: string }
      const lastNotifiedAt = meta.lastNotifiedAt ? new Date(meta.lastNotifiedAt) : null
      const dedupeWindowMs = 12 * 60 * 60 * 1000 // 12시간
      const shouldNotify =
        !lastNotifiedAt || Date.now() - lastNotifiedAt.getTime() >= dedupeWindowMs

      if (shouldNotify) {
        try {
          await notifyWorkerDown({
            service: WORKER_SERVICE,
            lastPingAt,
            thresholdMinutes: WORKER_HEARTBEAT_THRESHOLD_MIN,
          })
          workerCheck.notified = true
        } catch (err) {
          console.error('[cron/inventory-stale-check] worker-down Slack 실패:', err)
        }

        // dedupe marker 갱신 — heartbeat row가 없으면 placeholder 생성
        if (heartbeat) {
          await prisma.workerHeartbeat.update({
            where: { service: WORKER_SERVICE },
            data: {
              metadata: { ...meta, lastNotifiedAt: new Date().toISOString() },
            },
          })
        } else {
          await prisma.workerHeartbeat.create({
            data: {
              service: WORKER_SERVICE,
              lastPingAt: new Date(0),
              metadata: { lastNotifiedAt: new Date().toISOString() },
            },
          })
        }
      }
    }
  } catch (err) {
    console.error('[cron/inventory-stale-check] worker heartbeat 체크 실패:', err)
  }

  return { workspaces: checked, worker: workerCheck }
})
