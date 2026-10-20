/**
 * /api/agent/actions/[actionId]
 *  GET   — 단건 조회 (액션 소속 space 멤버만).
 *  PATCH — { action: "approve" | "reject" }. 액션 소속 space에서 필요 역할 이상인 멤버만.
 *
 * 보안: resolveSpaceContext는 호출자의 "현재" space(쿠키 wd_space)를 주므로 그것과 비교하면
 *   다중 space에서 오·과권한이 난다(현재 Space ≠ 액션의 Space). 반드시 **액션의 spaceId에 대한 호출자 멤버십**을
 *   조회해 역할을 확인한다(cross-space IDOR 차단).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { decideAction } from '@/lib/agent/actions/decide'
import { maskParams } from '@/lib/agent/audit'
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

  return NextResponse.json({
    action: {
      ...action,
      payload: maskParams(action.payload),
      beforeState: maskParams(action.beforeState),
      result: maskParams(action.result),
    },
  })
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

  // 판정 규칙은 일괄 승인(bulk)과 공유한다 — decideAction.
  const r = await decideAction(user.id, actionId, decision)
  if (r.error !== undefined) return errorResponse(r.error, r.status)
  return NextResponse.json({ outcome: r.outcome }, { status: r.status })
}
