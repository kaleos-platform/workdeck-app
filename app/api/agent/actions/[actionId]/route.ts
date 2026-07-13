/**
 * /api/agent/actions/[actionId]
 *  GET   — 단건 조회 (액션 소속 space 멤버만).
 *  PATCH — { action: "approve" | "reject" }. 액션 소속 space에서 필요 역할 이상인 멤버만.
 *
 * 보안: resolveSpaceContext는 호출자의 "최고참" space를 주므로 그것과 비교하면
 *   다중 space에서 오·과권한이 난다. 반드시 **액션의 spaceId에 대한 호출자 멤버십**을
 *   조회해 역할을 확인한다(cross-space IDOR 차단).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { errorResponse, assertRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { approveAndExecute, rejectAction } from '@/lib/agent/actions/execute'
import { getActionDefinition } from '@/lib/agent/actions/registry'
import type { SpaceMemberRole } from '@/lib/api-helpers'

// 호출자가 액션의 space에서 갖는 역할을 반환(멤버 아니면 null).
async function callerRoleInSpace(userId: string, spaceId: string): Promise<SpaceMemberRole | null> {
  const m = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } },
    select: { role: true },
  })
  return (m?.role as SpaceMemberRole) ?? null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ actionId: string }> }
) {
  const user = await getUser()
  if (!user) return errorResponse('인증이 필요합니다', 401)
  const { actionId } = await params

  const action = await prisma.agentPendingAction.findUnique({ where: { id: actionId } })
  if (!action) return errorResponse('액션을 찾을 수 없습니다', 404)

  // 액션 소속 space 멤버만 조회 가능.
  const role = await callerRoleInSpace(user.id, action.spaceId)
  if (!role) return errorResponse('권한이 없습니다', 403)

  return NextResponse.json({ action })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ actionId: string }> }
) {
  const user = await getUser()
  if (!user) return errorResponse('인증이 필요합니다', 401)
  const { actionId } = await params

  const body = await req.json().catch(() => ({}))
  const decision = (body as { action?: string }).action
  if (decision !== 'approve' && decision !== 'reject') {
    return errorResponse('action은 approve 또는 reject여야 합니다', 400)
  }

  const action = await prisma.agentPendingAction.findUnique({
    where: { id: actionId },
    select: { id: true, spaceId: true, actionType: true },
  })
  if (!action) return errorResponse('액션을 찾을 수 없습니다', 404)

  // 액션 소속 space에서의 호출자 역할 — cross-space 승인 차단.
  const role = await callerRoleInSpace(user.id, action.spaceId)
  if (!role) return errorResponse('권한이 없습니다', 403)

  // 액션 정의의 requiredRole 이상이어야 결정 가능(기본 ADMIN).
  const def = getActionDefinition(action.actionType)
  const required: SpaceMemberRole = def?.requiredRole ?? 'ADMIN'
  const roleError = assertRole(role, required)
  if (roleError) return roleError

  const outcome =
    decision === 'approve'
      ? await approveAndExecute(actionId, user.id)
      : await rejectAction(actionId, user.id)

  // CONFLICT(이미 처리/만료)면 409, 그 외는 결과 그대로 200.
  const httpStatus = outcome.status === 'CONFLICT' ? 409 : 200
  return NextResponse.json({ outcome }, { status: httpStatus })
}
