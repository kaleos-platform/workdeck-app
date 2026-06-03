import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveCronOrWorkerAuth } from '@/lib/api-helpers'
import { COUPANG_ADS_DECK_ID } from '@/lib/deck-routes'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'
import { getCoupangInventoryRows } from '@/lib/inv/reconciliation-sources'
import { runReconciliationMatch } from '@/lib/inv/reconciliation-core'
import { confirmReconciliation } from '@/lib/inv/reconciliation-processor'

export const runtime = 'nodejs'

const WORKER_SERVICE = 'coupang-inventory-sync'

/**
 * GET /api/cron/coupang-inventory-sync — Vercel cron 호출 전용.
 *
 * 쿠팡 로켓그로스 최신 재고현황(inventory_health) 스냅샷을 자동으로 대조·반영해
 * InvStockLevel 을 재고 truth 로 보정한다. 수동 '데이터 연동' 버튼 없이 매일 동작.
 *
 * - 소스(쿠팡 API availableStock)는 authoritative → matched-diff 자동 confirm(사람 검토 대체).
 * - file-only(미매핑) 는 사람 매핑 필요 → 자동 적용하지 않음(로그/표면화).
 * - 멱등 skip-marker: 같은 (spaceId, locationId, snapshotDate) 가 이미 APPLIED/PARTIAL 이면 skip.
 *
 * 인증: 워커(x-worker-api-key, 1차 — 수집 후 체이닝) 또는 Vercel cron(Bearer CRON_SECRET, 백스톱).
 */
export async function GET(request: NextRequest) {
  const auth = resolveCronOrWorkerAuth(request)
  if ('error' in auth) return auth.error

  const locations = await prisma.invStorageLocation.findMany({
    where: {
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
      isActive: true,
      locationMappings: { some: {} },
    },
    select: { spaceId: true },
    distinct: ['spaceId'],
  })

  const summary: Array<{
    spaceId: string
    status: string
    adjusted?: number
    fileOnly?: number
  }> = []

  for (const { spaceId } of locations) {
    try {
      const deck = await prisma.deckInstance.findUnique({
        where: { spaceId_deckAppId: { spaceId, deckAppId: COUPANG_ADS_DECK_ID } },
        select: { isActive: true },
      })
      if (!deck?.isActive) {
        summary.push({ spaceId, status: 'skip:deck-inactive' })
        continue
      }

      const resolved = await resolveCoupangWorkspaceForSpace(spaceId)
      if (!resolved) {
        summary.push({ spaceId, status: 'skip:no-workspace-link' })
        continue
      }

      // 최신 inventory_health 스냅샷 조회
      const parsed = await getCoupangInventoryRows(resolved.workspaceId)
      if (!parsed.snapshotDate || parsed.rows.length === 0) {
        summary.push({ spaceId, status: 'skip:no-snapshot' })
        continue
      }

      // 멱등 skip-marker — 같은 스냅샷이 이미 적용됐으면 skip (zero-delta 이동 누적 방지)
      const alreadyApplied = await prisma.invReconciliation.findFirst({
        where: {
          spaceId,
          locationId: resolved.locationId,
          snapshotDate: parsed.snapshotDate,
          status: { in: ['APPLIED', 'PARTIAL'] },
        },
        select: { id: true },
      })
      if (alreadyApplied) {
        summary.push({ spaceId, status: 'skip:already-applied' })
        continue
      }

      const fileName = `쿠팡 로켓그로스 재고 (자동 ${parsed.snapshotDate.toISOString().slice(0, 10)})`
      const core = await runReconciliationMatch({
        spaceId,
        parsed,
        locationId: resolved.locationId,
        fileName,
      })

      // matched-diff 만 자동 confirm (file-only 는 사람 매핑 필요)
      const matchedDiffOptionIds = core.matchResult.entries
        .filter((e) => e.status === 'matched-diff')
        .map((e) => e.optionId)
      const fileOnlyCount = core.matchResult.entries.filter((e) => e.status === 'file-only').length

      let adjusted = 0
      if (matchedDiffOptionIds.length > 0) {
        const confirmed = await confirmReconciliation(spaceId, core.reconciliationId, {
          selectedOptionIds: matchedDiffOptionIds,
          manualMappings: [],
        })
        adjusted = confirmed.adjustedCount
      } else if (fileOnlyCount === 0) {
        // 변동·미매핑 둘 다 없음(전부 matched-equal) → PENDING 누적 방지 위해 APPLIED 마킹.
        // skip-marker(APPLIED/PARTIAL)가 다음 실행에서 같은 스냅샷을 걸러낸다.
        // (file-only 가 있으면 사람 매핑이 필요하므로 PENDING 유지해 표면화.)
        await prisma.invReconciliation.update({
          where: { id: core.reconciliationId },
          data: { status: 'APPLIED' },
        })
      }

      if (fileOnlyCount > 0) {
        console.warn(
          `[cron/${WORKER_SERVICE}] space ${spaceId}: 미매핑(file-only) ${fileOnlyCount}건 — 사람 매핑 필요`
        )
      }

      summary.push({ spaceId, status: 'ok', adjusted, fileOnly: fileOnlyCount })
    } catch (err) {
      console.error(`[cron/${WORKER_SERVICE}] space ${spaceId} 실패:`, err)
      summary.push({ spaceId, status: 'error' })
    }
  }

  await prisma.workerHeartbeat
    .upsert({
      where: { service: WORKER_SERVICE },
      create: { service: WORKER_SERVICE, lastPingAt: new Date() },
      update: { lastPingAt: new Date() },
    })
    .catch(() => {})

  return NextResponse.json({ ranAt: new Date().toISOString(), spaces: summary })
}
