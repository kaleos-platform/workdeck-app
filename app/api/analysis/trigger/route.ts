// POST /api/analysis/trigger — AI 분석 트리거

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'
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
  let body: { from?: string; to?: string; reportType?: string; workspaceId?: string; triggeredBy?: string }
  if (isWorker) {
    body = bodyData!
  } else {
    try {
      body = await request.json()
    } catch {
      return errorResponse('잘못된 요청 형식입니다', 400)
    }
  }

  const { from, to, reportType = 'DAILY_REVIEW', triggeredBy = 'manual' } = body

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
      triggeredBy,
    },
  })

  // Worker가 PENDING 리포트를 폴링하여 실행
  return NextResponse.json({ reportId: report.id, status: 'PENDING' }, { status: 202 })
}
