// GET /api/analysis/schedule/active — 활성 분석 스케줄 전체 조회 (워커 전용)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'

/** GET — 활성화된 모든 분석 스케줄 반환 (워커 크론에서 호출) */
export async function GET(request: NextRequest) {
  // 워커 인증
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const schedules = await prisma.analysisSchedule.findMany({
    where: { enabled: true },
    select: {
      workspaceId: true,
      enabled: true,
      intervalDays: true,
      slackNotify: true,
      lastAnalyzedAt: true,
    },
  })

  return NextResponse.json({ schedules })
}
