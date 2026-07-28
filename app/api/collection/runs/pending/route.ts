import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkerAuth } from '@/lib/api-helpers'
import { canWorkspaceCollect } from '@/lib/billing/entitlement'

// 10분 이상 된 PENDING은 무시 (stale)
const STALE_THRESHOLD_MS = 10 * 60 * 1000

// GET /api/collection/runs/pending — Worker가 미처리 수동 수집을 폴링
export async function GET(request: NextRequest) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS)

  const runs = await prisma.collectionRun.findMany({
    where: {
      status: 'PENDING',
      createdAt: { gt: staleThreshold },
    },
    orderBy: { createdAt: 'asc' },
    take: 10,
  })

  // 결제 entitlement 필터: 만료 workspace의 run은 워커에 넘기지 않는다
  // (게이트를 통과해 이미 큐에 있던 run 방어 — run 생성 게이트와 이중)
  for (const run of runs) {
    if (await canWorkspaceCollect(run.workspaceId)) {
      return NextResponse.json({
        run: {
          id: run.id,
          workspaceId: run.workspaceId,
          triggeredBy: run.triggeredBy,
          collectAds: run.collectAds,
          collectInventory: run.collectInventory,
        },
      })
    }
  }

  return NextResponse.json({ run: null })
}
