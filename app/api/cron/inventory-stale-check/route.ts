import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyInventoryStaleData, notifyWorkerDown } from '@/lib/slack-inventory-notifier'

export const runtime = 'nodejs'

const STALE_THRESHOLD_DAYS = 2
const WORKER_HEARTBEAT_THRESHOLD_MIN = 10 // 10분 이상 ping 없으면 다운으로 간주
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
 * Vercel cron 인증: `Authorization: Bearer ${CRON_SECRET}` 헤더 필수.
 * CRON_SECRET가 설정되지 않으면 라우트가 비활성화된다(401).
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET 미설정' }, { status: 401 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

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
      // dedupe — 같은 snapshotDate에 marker가 있으면 skip
      const existing = await prisma.inventoryAnalysis.findFirst({
        where: {
          workspaceId: row.workspaceId,
          snapshotDate: row.snapshotDate,
          triggeredBy: 'stale-skip',
        },
        select: { id: true },
      })

      if (!existing) {
        try {
          await notifyInventoryStaleData({
            snapshotDate: row.snapshotDate,
            ageDays,
          })
          notified = true
        } catch (err) {
          console.error(`[cron/inventory-stale-check] Slack 실패 (${row.workspaceId}):`, err)
        }

        // Slack 전송 성공 시에만 dedupe 마커 기록.
        // 실패 시 마커 없음 → 다음 cron 실행에서 재시도(영구 침묵 방지).
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

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    workspaces: checked,
    worker: workerCheck,
  })
}
