import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { COUPANG_ADS_DECK_ID } from '@/lib/deck-routes'

// GET /api/sh/inventory/reconciliation/coupang-preflight
// 데이터 연동 다이얼로그 진입 시 호출. 기준일/덮어쓰기 안내에 필요한 메타데이터 조회.
export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id
  const userId = resolved.user.id

  const [deckInstance, mappedLocation, workspace] = await Promise.all([
    prisma.deckInstance.findUnique({
      where: { spaceId_deckAppId: { spaceId, deckAppId: COUPANG_ADS_DECK_ID } },
      select: { isActive: true },
    }),
    prisma.invStorageLocation.findFirst({
      where: { spaceId, externalSource: 'coupang_rocket_growth', isActive: true },
      select: { id: true, name: true },
    }),
    prisma.workspace.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    }),
  ])

  const coupangActive = !!deckInstance?.isActive
  const workspaceExists = !!workspace

  const latestSnapshotRow = workspace
    ? await prisma.inventoryUpload.findFirst({
        where: { workspaceId: workspace.id, fileType: 'INVENTORY_HEALTH' },
        orderBy: { snapshotDate: 'desc' },
        select: { snapshotDate: true },
      })
    : null

  const lastReconciliation = mappedLocation
    ? await prisma.invReconciliation.findFirst({
        // CANCELLED 는 사용자가 삭제한 대조 — 자동 대조 cron 의 스냅샷 마커로만 남아 있으므로
        // "최근 대조" 표시에서는 제외한다(지운 것이 최근 대조로 보이면 안 된다).
        where: { spaceId, locationId: mappedLocation.id, status: { not: 'CANCELLED' } },
        orderBy: { snapshotDate: 'desc' },
        select: { id: true, snapshotDate: true, createdAt: true, status: true },
      })
    : null

  // KST 일자 표기 (UI 표시용)
  const toKstDisplay = (d: Date) =>
    new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(d)
      .replace(/\. /g, '-')
      .replace(/\.$/, '')

  return NextResponse.json({
    coupangActive,
    workspaceExists,
    mappedLocation,
    latestSnapshot: latestSnapshotRow
      ? {
          snapshotDate: latestSnapshotRow.snapshotDate.toISOString(),
          displayDate: toKstDisplay(latestSnapshotRow.snapshotDate),
        }
      : null,
    lastReconciliation: lastReconciliation
      ? {
          id: lastReconciliation.id,
          snapshotDate: lastReconciliation.snapshotDate.toISOString(),
          displayDate: toKstDisplay(lastReconciliation.snapshotDate),
          status: lastReconciliation.status,
        }
      : null,
  })
}
