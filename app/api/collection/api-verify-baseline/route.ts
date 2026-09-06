/**
 * /api/collection/api-verify-baseline — 워커 전용. 최신 INVENTORY_HEALTH 크롤링 스냅샷의
 * 요약 통계를 반환한다. `worker/src/coupang-api/verify.ts`(Phase 0 대조 스크립트)가
 * API 응답과 대조하는 baseline 으로 쓴다.
 *
 * 응답 스키마:
 * {
 *   baseline: {
 *     snapshotDate: string | null        // 최신 INVENTORY_HEALTH 스냅샷 기준일 (ISO), 없으면 null
 *     rowCount: number                   // 그 스냅샷의 InventoryRecord 행 수
 *     uniqueOptionIdCount: number        // 고유 optionId 집합 크기
 *     uniqueSkuIdCount: number           // 고유 skuId 집합 크기 (skuId null 은 제외)
 *     totalAvailableStock: number        // availableStock(가용재고) 합계
 *   } | null   // INVENTORY_HEALTH 스냅샷이 하나도 없으면 null
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'

export async function GET(request: NextRequest) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const url = new URL(request.url)
  const workspaceId = url.searchParams.get('workspaceId')
  if (!workspaceId) {
    return errorResponse('workspaceId 쿼리 파라미터가 필요합니다', 400)
  }

  const latestUpload = await prisma.inventoryUpload.findFirst({
    where: { workspaceId, fileType: 'INVENTORY_HEALTH' },
    orderBy: { snapshotDate: 'desc' },
    select: { snapshotDate: true },
  })

  if (!latestUpload) {
    return NextResponse.json({ baseline: null })
  }

  const records = await prisma.inventoryRecord.findMany({
    where: {
      workspaceId,
      fileType: 'INVENTORY_HEALTH',
      snapshotDate: latestUpload.snapshotDate,
    },
    select: { optionId: true, skuId: true, availableStock: true },
  })

  const uniqueOptionIds = new Set(records.map((r) => r.optionId))
  const uniqueSkuIds = new Set(records.map((r) => r.skuId).filter((v): v is string => v != null))
  const totalAvailableStock = records.reduce((sum, r) => sum + (r.availableStock ?? 0), 0)

  return NextResponse.json({
    baseline: {
      snapshotDate: latestUpload.snapshotDate,
      rowCount: records.length,
      uniqueOptionIdCount: uniqueOptionIds.size,
      uniqueSkuIdCount: uniqueSkuIds.size,
      totalAvailableStock,
    },
  })
}
