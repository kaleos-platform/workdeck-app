import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { ActionType, ExecutionStatus } from '@/generated/prisma/client'
import type { Prisma } from '@/generated/prisma/client'

// GET /api/execution/tasks — 실행 태스크 목록 (status 필터, 최신순)
export async function GET(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { searchParams } = request.nextUrl
  const statusParam = searchParams.get('status')

  // status 파라미터 유효성 검증
  const where: { workspaceId: string; status?: ExecutionStatus } = {
    workspaceId: workspace.id,
  }
  if (statusParam) {
    if (!Object.values(ExecutionStatus).includes(statusParam as ExecutionStatus)) {
      return errorResponse(`유효하지 않은 status: ${statusParam}`, 400)
    }
    where.status = statusParam as ExecutionStatus
  }

  const tasks = await prisma.executionTask.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(tasks)
}

// POST /api/execution/tasks — 제안에서 태스크 생성
export async function POST(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const body = await request.json()
  const { analysisReportId, actionType, campaignId, target, params } = body as {
    analysisReportId?: string
    actionType: string
    campaignId: string
    target: string
    params: Prisma.InputJsonValue
  }

  // 필수 필드 검증
  if (!actionType || !campaignId || !target || params === undefined) {
    return errorResponse('actionType, campaignId, target, params는 필수입니다', 400)
  }

  // actionType 유효성 검증
  if (!Object.values(ActionType).includes(actionType as ActionType)) {
    return errorResponse(`유효하지 않은 actionType: ${actionType}`, 400)
  }

  const task = await prisma.executionTask.create({
    data: {
      workspaceId: workspace.id,
      analysisReportId: analysisReportId ?? null,
      actionType: actionType as ActionType,
      campaignId,
      target,
      params,
    },
  })

  return NextResponse.json(task, { status: 201 })
}
