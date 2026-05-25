import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyInventoryStaleData } from '@/lib/slack-inventory-notifier'

export const runtime = 'nodejs'

const STALE_THRESHOLD_DAYS = 2

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

    checked.push({ workspaceId: row.workspaceId, ageDays, stale, notified })
  }

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    workspaces: checked,
  })
}
