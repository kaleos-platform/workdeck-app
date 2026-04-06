import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkerAuth } from '@/lib/api-helpers'

// GET /api/collection/schedule/active — Worker용 활성 수집 스케줄 조회
export async function GET(request: NextRequest) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const schedules = await prisma.collectionSchedule.findMany({
    where: { enabled: true },
    select: {
      workspaceId: true,
      cronExpression: true,
      timezone: true,
    },
  })

  return NextResponse.json({ schedules })
}
