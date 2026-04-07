// POST /api/analysis/reports/[reportId]/run — Worker용 분석 동기 실행

// Vercel 함수 타임아웃 확장 (OpenRouter API 호출 대기)
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'
import { buildAnalysisContext } from '@/lib/analysis/data-builder'
import { analyzeAdPerformance } from '@/lib/ai/analyzer'

/** POST — 지정된 리포트에 대해 분석을 동기 실행하고 결과 반환 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const { reportId } = await params

  const report = await prisma.analysisReport.findFirst({
    where: { id: reportId, status: 'PENDING' },
  })

  if (!report) {
    return errorResponse('PENDING 상태의 리포트를 찾을 수 없습니다', 404)
  }

  // PROCESSING으로 변경
  await prisma.analysisReport.update({
    where: { id: reportId },
    data: { status: 'PROCESSING' },
  })

  try {
    // 데이터 빌드
    const context = await buildAnalysisContext(
      report.workspaceId,
      report.periodStart,
      report.periodEnd,
      report.reportType,
    )

    // AI 분석 실행
    const result = await analyzeAdPerformance(context)

    // 요약 생성
    const summary = `${context.campaigns.length}개 캠페인 분석 완료. ${result.suggestions.length}개 제안 생성.`

    // 완료 상태로 업데이트
    await prisma.analysisReport.update({
      where: { id: reportId },
      data: {
        status: 'COMPLETED',
        summary,
        suggestions: JSON.parse(JSON.stringify(result.suggestions)),
        metadata: {
          campaignCount: context.campaigns.length,
          inefficientKeywordCount: context.inefficientKeywords.length,
          improvementSuggestions: JSON.parse(JSON.stringify(result.improvementSuggestions)),
          activeRulesCount: context.activeRules.length,
          model: result.modelUsed,
        },
      },
    })

    // 분석 스케줄의 lastAnalyzedAt 갱신
    await prisma.analysisSchedule.updateMany({
      where: { workspaceId: report.workspaceId },
      data: { lastAnalyzedAt: new Date() },
    })

    // 활성 규칙의 appliedCount 증가
    if (context.activeRules.length > 0) {
      await prisma.analysisRule.updateMany({
        where: { id: { in: context.activeRules.map((r) => r.id) } },
        data: { appliedCount: { increment: 1 } },
      })
    }

    return NextResponse.json({
      status: 'COMPLETED',
      summary,
      suggestionCount: result.suggestions.length,
      campaignCount: context.campaigns.length,
    })
  } catch (err) {
    // 실패 상태로 업데이트
    const errorMessage = err instanceof Error ? err.message : '알 수 없는 오류'
    await prisma.analysisReport.update({
      where: { id: reportId },
      data: {
        status: 'FAILED',
        summary: `분석 실패: ${errorMessage}`,
      },
    })

    return NextResponse.json(
      { status: 'FAILED', error: errorMessage },
      { status: 500 },
    )
  }
}
