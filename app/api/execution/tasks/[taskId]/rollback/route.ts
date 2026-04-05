import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// POST /api/execution/tasks/[taskId]/rollback — 태스크 롤백
export async function POST(
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

  // 완료 또는 실패 상태만 롤백 가능
  if (task.status !== 'COMPLETED' && task.status !== 'FAILED') {
    return errorResponse('완료 또는 실패 상태의 태스크만 롤백할 수 있습니다', 400)
  }

  const updated = await prisma.executionTask.update({
    where: { id: taskId },
    data: { status: 'ROLLED_BACK' },
  })

  return NextResponse.json(updated)
}
