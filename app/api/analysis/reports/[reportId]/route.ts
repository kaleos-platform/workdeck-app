// GET /api/analysis/reports/[reportId] — 개별 분석 리포트 상세 조회

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { reportId } = await params

  const report = await prisma.analysisReport.findFirst({
    where: {
      id: reportId,
      workspaceId: workspace.id,
    },
  })

  if (!report) {
    return errorResponse('리포트를 찾을 수 없습니다', 404)
  }

  return NextResponse.json({ report })
}
