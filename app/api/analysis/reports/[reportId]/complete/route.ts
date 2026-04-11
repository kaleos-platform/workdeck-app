// POST /api/analysis/reports/[reportId]/complete — 분석 결과 저장 (Worker용)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'

/** POST — 분석 결과를 저장하고 COMPLETED로 전환 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const { reportId } = await params

  const report = await prisma.analysisReport.findFirst({
    where: { id: reportId, status: 'PROCESSING' },
  })

  if (!report) {
    return errorResponse('PROCESSING 상태의 리포트를 찾을 수 없습니다', 404)
  }

  let body: {
    status: 'COMPLETED' | 'FAILED'
    summary: string
    suggestions?: unknown[]
    metadata?: Record<string, unknown>
    error?: string
  }
  try {
    body = await request.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  if (body.status === 'COMPLETED') {
    await prisma.analysisReport.update({
      where: { id: reportId },
      data: {
        status: 'COMPLETED',
        summary: body.summary,
        suggestions: body.suggestions ? JSON.parse(JSON.stringify(body.suggestions)) : [],
        metadata: body.metadata ? JSON.parse(JSON.stringify(body.metadata)) : undefined,
      },
    })

    // 분석 스케줄의 lastAnalyzedAt 갱신
    await prisma.analysisSchedule.updateMany({
      where: { workspaceId: report.workspaceId },
      data: { lastAnalyzedAt: new Date() },
    })

    // 활성 규칙의 appliedCount 증가
    const activeRuleIds = (body.metadata?.activeRuleIds as string[]) ?? []
    if (activeRuleIds.length > 0) {
      await prisma.analysisRule.updateMany({
        where: { id: { in: activeRuleIds } },
        data: { appliedCount: { increment: 1 } },
      })
    }

    return NextResponse.json({ status: 'COMPLETED' })
  } else {
    await prisma.analysisReport.update({
      where: { id: reportId },
      data: {
        status: 'FAILED',
        summary: body.error ? `분석 실패: ${body.error}` : '분석 실패',
      },
    })
    return NextResponse.json({ status: 'FAILED' })
  }
}
