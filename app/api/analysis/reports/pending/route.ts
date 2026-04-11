// GET /api/analysis/reports/pending — Worker용 PENDING 분석 리포트 조회

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'

/** GET — 가장 오래된 PENDING 리포트 1건 반환 */
export async function GET(request: NextRequest) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const report = await prisma.analysisReport.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      workspaceId: true,
      periodStart: true,
      periodEnd: true,
      reportType: true,
    },
  })

  return NextResponse.json({ report: report ?? null })
}
