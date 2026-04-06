import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkerAuth } from '@/lib/api-helpers'

// 10분 이상 된 PENDING은 무시 (stale)
const STALE_THRESHOLD_MS = 10 * 60 * 1000

// GET /api/collection/runs/pending — Worker가 미처리 수동 수집을 폴링
export async function GET(request: NextRequest) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS)

  const run = await prisma.collectionRun.findFirst({
    where: {
      status: 'PENDING',
      createdAt: { gt: staleThreshold },
    },
    orderBy: { createdAt: 'asc' },
    include: {
      workspace: { select: { id: true } },
    },
  })

  if (!run) {
    return NextResponse.json({ run: null })
  }

  return NextResponse.json({
    run: {
      id: run.id,
      workspaceId: run.workspaceId,
      triggeredBy: run.triggeredBy,
    },
  })
}
