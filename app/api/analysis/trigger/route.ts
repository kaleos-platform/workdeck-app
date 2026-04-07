// POST /api/analysis/trigger — AI 분석 트리거

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'
import { buildAnalysisContext } from '@/lib/analysis/data-builder'
import { analyzeAdPerformance } from '@/lib/ai/analyzer'
import type { AnalysisType } from '@/generated/prisma/client'

const VALID_TYPES: AnalysisType[] = ['DAILY_REVIEW', 'KEYWORD_AUDIT', 'BUDGET_OPTIMIZATION', 'CAMPAIGN_SCORING']

export async function POST(request: NextRequest) {
  // Worker 인증 또는 사용자 세션 인증
  const workerKey = request.headers.get('x-worker-api-key')
  const expectedKey = process.env.WORKER_API_KEY
  const isWorker = Boolean(workerKey && expectedKey && workerKey === expectedKey)

  let workspaceId: string

  if (isWorker) {
    // Worker: body에서 workspaceId 읽기
    const rawBody = await request.text()
    const parsed = JSON.parse(rawBody)
    if (!parsed.workspaceId) {
      return errorResponse('workspaceId가 필요합니다', 400)
    }
    workspaceId = parsed.workspaceId
    // body를 다시 사용할 수 있도록 저장
    var bodyData = parsed
  } else {
    const resolved = await resolveWorkspace()
    if ('error' in resolved) return resolved.error
    workspaceId = resolved.workspace.id
  }

  const workspace = { id: workspaceId }

  // 요청 바디 파싱
  let body: { from?: string; to?: string; reportType?: string; workspaceId?: string }
  if (isWorker) {
    body = bodyData!
  } else {
    try {
      body = await request.json()
    } catch {
      return errorResponse('잘못된 요청 형식입니다', 400)
    }
  }

  const { from, to, reportType = 'DAILY_REVIEW' } = body

  if (!from || !to) {
    return errorResponse('from, to 날짜가 필요합니다', 400)
  }

  if (!VALID_TYPES.includes(reportType as AnalysisType)) {
    return errorResponse('유효하지 않은 분석 유형입니다', 400)
  }

  const periodStart = new Date(from + 'T00:00:00+09:00')
  const periodEnd = new Date(to + 'T23:59:59+09:00')

  // PENDING 상태로 리포트 생성
  const report = await prisma.analysisReport.create({
    data: {
      workspaceId: workspace.id,
      periodStart,
      periodEnd,
      reportType: reportType as AnalysisType,
      summary: '',
      suggestions: [],
      status: 'PENDING',
    },
  })

  // 백그라운드에서 분석 실행 (PoC: fire-and-forget)
  runAnalysis(report.id, workspace.id, periodStart, periodEnd, reportType as AnalysisType).catch(
    (err) => console.error('[analysis] 분석 실행 실패:', report.id, err)
  )

  return NextResponse.json({ reportId: report.id, status: 'PENDING' }, { status: 202 })
}

/** 분석 실행 (백그라운드) */
async function runAnalysis(
  reportId: string,
  workspaceId: string,
  periodStart: Date,
  periodEnd: Date,
  reportType: AnalysisType
) {
  // PROCESSING 상태로 변경
  await prisma.analysisReport.update({
    where: { id: reportId },
    data: { status: 'PROCESSING' },
  })

  try {
    // 데이터 빌드
    const context = await buildAnalysisContext(workspaceId, periodStart, periodEnd, reportType)

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
      where: { workspaceId },
      data: { lastAnalyzedAt: new Date() },
    })

    // 활성 규칙의 appliedCount 증가
    if (context.activeRules.length > 0) {
      await prisma.analysisRule.updateMany({
        where: {
          id: { in: context.activeRules.map((r) => r.id) },
        },
        data: { appliedCount: { increment: 1 } },
      })
    }
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
  }
}
