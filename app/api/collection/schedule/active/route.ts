import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWorker, workerWorkspaceWhere } from '@/lib/worker-auth'

// GET /api/collection/schedule/active — Worker용 활성 수집 스케줄 조회
export async function GET(request: NextRequest) {
  const auth = await authenticateWorker(request.headers)
  if ('error' in auth) return auth.error

  const schedules = await prisma.collectionSchedule.findMany({
    where: { enabled: true, ...workerWorkspaceWhere(auth.scope) },
    select: {
      workspaceId: true,
      cronExpression: true,
      timezone: true,
    },
  })

  return NextResponse.json({ schedules })
}
