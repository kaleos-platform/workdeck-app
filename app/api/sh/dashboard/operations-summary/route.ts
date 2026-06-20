import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'

// 홈 대시보드 "운영" 섹션 통합 — 데이터 연동 현황 + 생산 입고 미처리.
// 두 카드(연동 상태 / 생산 입고대기)가 이 한 응답을 공유한다.
//
// 연동: CollectionRun/CoupangBackfillJob FAILED (workspace 스코프 — 쿠팡 미연동이면 빈 결과)
//       + WorkerHeartbeat 다운 (전역 — service @unique, space 컬럼 없음).
// 생산: ProductionRun ORDERED && stockedInAt=null (발주완료·입고 미처리).

const WORKER_HEARTBEAT_THRESHOLD_MIN = 10 // cron/inventory-stale-check 와 동일
const RECENT_FAILURE_DAYS = 14 // "지금 조치할 항목"이므로 최근 실패만 (영구 누적 방지)

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id

  // ── 쿠팡 workspace 브릿지 (미연동이면 연동 카운트 0) ─────────────────────
  const coupang = await resolveCoupangWorkspaceForSpace(spaceId)
  const coupangLinked = coupang != null

  const heartbeatCutoff = new Date(Date.now() - WORKER_HEARTBEAT_THRESHOLD_MIN * 60_000)
  const recentCutoff = new Date(Date.now() - RECENT_FAILURE_DAYS * 24 * 60 * 60 * 1000)
  // 워커 다운 판정 하한: 최근 N일 안에 활동(ping)했던 워커만 대상. decommission 되어
  // 영원히 죽은 워커 레코드가 영구 알림으로 남는 것을 방지 ("지금 조치할 항목"이 의도).

  const [failedCollectionRuns, failedBackfillJobs, downWorkerRows, pendingStockInRuns] =
    await Promise.all([
      coupang
        ? prisma.collectionRun.count({
            where: {
              workspaceId: coupang.workspaceId,
              status: 'FAILED',
              createdAt: { gte: recentCutoff },
            },
          })
        : Promise.resolve(0),
      coupang
        ? prisma.coupangBackfillJob.count({
            where: {
              workspaceId: coupang.workspaceId,
              status: 'FAILED',
              createdAt: { gte: recentCutoff },
            },
          })
        : Promise.resolve(0),
      // WorkerHeartbeat 는 전역 — 임계(10분) 이전 ~ recentCutoff(14일) 이후 사이.
      // (임계 이전 = 끊김, recentCutoff 이후 = 최근까지 살아있던 워커 → 진짜 "최근 다운".)
      prisma.workerHeartbeat.findMany({
        where: { lastPingAt: { lt: heartbeatCutoff, gte: recentCutoff } },
        select: { service: true, lastPingAt: true },
      }),
      // 생산: 발주완료(ORDERED) + 입고 미처리(stockedInAt=null)
      prisma.productionRun.findMany({
        where: { spaceId, status: 'ORDERED', stockedInAt: null },
        select: {
          id: true,
          runNo: true,
          dueAt: true,
          brand: { select: { name: true } },
        },
        orderBy: [{ dueAt: 'asc' }, { runNo: 'asc' }],
      }),
    ])

  const downWorkers = downWorkerRows.map((w) => ({
    service: w.service,
    lastPingAt: w.lastPingAt.toISOString(),
  }))

  const productionSamples = pendingStockInRuns.slice(0, 5).map((r) => ({
    runId: r.id,
    runNo: r.runNo,
    brandName: r.brand?.name ?? null,
    dueAt: r.dueAt?.toISOString() ?? null,
  }))

  return NextResponse.json({
    integration: {
      coupangLinked,
      failedCollectionRuns,
      failedBackfillJobs,
      downWorkers,
    },
    production: {
      pendingStockInCount: pendingStockInRuns.length,
      samples: productionSamples,
    },
  })
}
