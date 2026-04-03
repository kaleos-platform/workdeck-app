import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// GET /api/execution/tasks/[taskId] — 태스크 상세 조회
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved
  const { taskId } = await params

  const task = await prisma.executionTask.findFirst({
    where: { id: taskId, workspaceId: workspace.id },
  })

  if (!task) {
    return errorResponse('태스크를 찾을 수 없습니다', 404)
  }

  return NextResponse.json(task)
}

// PATCH /api/execution/tasks/[taskId] — 승인 또는 거부
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace, user } = resolved
  const { taskId } = await params

  const task = await prisma.executionTask.findFirst({
    where: { id: taskId, workspaceId: workspace.id },
  })

  if (!task) {
    return errorResponse('태스크를 찾을 수 없습니다', 404)
  }

  if (task.status !== 'PENDING_APPROVAL') {
    return errorResponse('승인 대기 상태의 태스크만 처리할 수 있습니다', 400)
  }

  const body = await request.json()
  const { action } = body as { action: 'approve' | 'reject' }

  if (action === 'approve') {
    // 승인: status → APPROVED, approvedAt/By 설정
    const updated = await prisma.executionTask.update({
      where: { id: taskId },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: user.id,
      },
    })
    return NextResponse.json(updated)
  } else if (action === 'reject') {
    // 거부: 태스크 삭제
    await prisma.executionTask.delete({
      where: { id: taskId },
    })
    return NextResponse.json({ message: '태스크가 거부되어 삭제되었습니다' })
  }

  return errorResponse('action은 approve 또는 reject여야 합니다', 400)
}
