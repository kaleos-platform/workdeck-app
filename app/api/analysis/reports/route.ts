// GET /api/analysis/reports — 분석 리포트 목록 조회

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'

export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const reports = await prisma.analysisReport.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      reportType: true,
      summary: true,
      status: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ reports })
}
