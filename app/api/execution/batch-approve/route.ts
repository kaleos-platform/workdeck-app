import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// POST /api/execution/batch-approve — 여러 태스크 일괄 승인
export async function POST(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved
  const user = 'user' in resolved ? resolved.user : undefined

  const body = await request.json()
  const { taskIds } = body as { taskIds: string[] }

  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return errorResponse('taskIds 배열이 필요합니다', 400)
  }

  // 워크스페이스 소속 + 승인 대기 상태인 태스크만 필터
  const tasks = await prisma.executionTask.findMany({
    where: {
      id: { in: taskIds },
      workspaceId: workspace.id,
      status: 'PENDING_APPROVAL',
    },
    select: { id: true },
  })

  const validIds = tasks.map((t) => t.id)

  if (validIds.length === 0) {
    return errorResponse('승인 가능한 태스크가 없습니다', 400)
  }

  // 일괄 승인 업데이트
  const result = await prisma.executionTask.updateMany({
    where: { id: { in: validIds } },
    data: {
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedBy: user?.id ?? 'system',
    },
  })

  return NextResponse.json({
    approved: result.count,
    skipped: taskIds.length - validIds.length,
  })
}
