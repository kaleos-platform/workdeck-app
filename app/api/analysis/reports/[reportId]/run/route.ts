// POST /api/analysis/reports/[reportId]/run — 분석 컨텍스트 빌드 + PROCESSING 전환
// GET  /api/analysis/reports/[reportId]/run — 분석 컨텍스트 조회 (Worker용)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'
import { buildAnalysisContext } from '@/lib/analysis/data-builder'
import { getSystemPrompt } from '@/lib/ai/prompts'

/** POST — PENDING → PROCESSING 전환 + 분석 컨텍스트(프롬프트) 반환 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const { reportId } = await params

  // 원자적 claim: PENDING인 경우에만 PROCESSING 전환 (동시 요청 중 하나만 성공)
  const claimed = await prisma.analysisReport.updateMany({
    where: { id: reportId, status: 'PENDING' },
    data: { status: 'PROCESSING' },
  })
  if (claimed.count !== 1) {
    return errorResponse('PENDING 상태의 리포트를 찾을 수 없습니다', 404)
  }

  // claim 후 downstream에서 report 객체 사용을 위해 재조회
  const report = await prisma.analysisReport.findUnique({ where: { id: reportId } })
  if (!report) return errorResponse('리포트를 찾을 수 없습니다', 404)

  try {
    // 분석 컨텍스트 빌드 (DB 쿼리만 — 빠름)
    const context = await buildAnalysisContext(
      report.workspaceId,
      report.periodStart,
      report.periodEnd,
      report.reportType
    )

    // 시스템 프롬프트 + 사용자 프롬프트 생성
    const systemPrompt = getSystemPrompt(report.reportType, context.activeRules)

    return NextResponse.json({
      reportId,
      workspaceId: report.workspaceId,
      context: {
        systemPrompt,
        campaigns: context.campaigns,
        inefficientKeywords: context.inefficientKeywords,
        removedKeywords: context.removedKeywords,
        removedProducts: context.removedProducts,
        campaignTargets: context.campaignTargets,
        recentMemos: context.recentMemos,
        campaignMetas: context.campaignMetas,
        activeRules: context.activeRules,
        periodStart: context.periodStart,
        periodEnd: context.periodEnd,
        reportType: context.reportType,
      },
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : '알 수 없는 오류'
    await prisma.analysisReport.update({
      where: { id: reportId },
      data: { status: 'FAILED', summary: `컨텍스트 빌드 실패: ${errorMessage}` },
    })
    return NextResponse.json({ status: 'FAILED', error: errorMessage }, { status: 500 })
  }
}
