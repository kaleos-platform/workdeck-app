// PATCH·DELETE /api/spaces/members/[memberId] — OWNER가 구성원 역할(ADMIN↔MEMBER)을 바꾸거나 내보낸다.
// OWNER + MFA(aal2) 전용, MCP 도구는 두지 않는다(권한 정책은 사람만 바꾼다). OWNER 구성원·본인은 대상이 아니다.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { requireAal2 } from '@/lib/auth/mfa'
import { writeAuditLog } from '@/lib/admin/auth'
import { requireSpaceOwner } from '@/lib/agent/identity/space-admin'

type Ctx = { params: Promise<{ memberId: string }> }
type Target = { id: string; spaceId: string; userId: string; role: string }

const bodySchema = z.object({ role: z.enum(['ADMIN', 'MEMBER']) })
const NOT_FOUND = '구성원을 찾을 수 없습니다'

async function guard(
  memberId: string
): Promise<{ ownerId: string; target: Target } | { error: NextResponse }> {
  const target = await prisma.spaceMember.findUnique({
    where: { id: memberId },
    select: { id: true, spaceId: true, userId: true, role: true },
  })
  if (!target) return { error: errorResponse(NOT_FOUND, 404) }
  const owner = await requireSpaceOwner(target.spaceId)
  if ('error' in owner) {
    // 남의 Space 구성원 id 를 넣어 존재 여부를 알아내지 못하게 403 도 404 로 돌린다.
    return { error: owner.error.status === 403 ? errorResponse(NOT_FOUND, 404) : owner.error }
  }
  const mfa = await requireAal2()
  if (mfa) return { error: mfa }
  if (target.userId === owner.userId)
    return { error: errorResponse('본인은 바꿀 수 없습니다', 400) }
  if (target.role === 'OWNER') return { error: errorResponse('OWNER는 바꿀 수 없습니다', 400) }
  return { ownerId: owner.userId, target }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const g = await guard((await params).memberId)
  if ('error' in g) return g.error
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('역할(ADMIN·MEMBER)을 확인하세요', 422)
  const { target, ownerId } = g
  const { role } = parsed.data

  // 확인 뒤 다른 경로(운영자 콘솔)에서 OWNER 로 바뀌었거나 지워졌으면 건드리지 않는다.
  const { count } = await prisma.spaceMember.updateMany({
    where: { id: target.id, spaceId: target.spaceId, role: { not: 'OWNER' } },
    data: { role },
  })
  if (count === 0) return errorResponse(NOT_FOUND, 404)
  await writeAuditLog(ownerId, 'space.member.role_change', 'space_member', target.id, {
    spaceId: target.spaceId,
    userId: target.userId,
    fromRole: target.role,
    toRole: role,
  })
  return NextResponse.json({ member: { id: target.id, role } })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const g = await guard((await params).memberId)
  if ('error' in g) return g.error
  const { target, ownerId } = g

  // 내보낸 사람이 요청한 승인 대기 건은 같은 트랜잭션에서 거절한다 — 모르고 승인하지 않게.
  const removed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.spaceMember.deleteMany({
      where: { id: target.id, spaceId: target.spaceId, role: { not: 'OWNER' } },
    })
    if (count === 0) return null
    const rejected = await tx.agentPendingAction.updateMany({
      where: {
        spaceId: target.spaceId,
        status: 'PENDING',
        // 에이전트 경유(requesterUserId)와 본인 MCP·웹 세션(actorType user) 둘 다.
        OR: [{ requesterUserId: target.userId }, { actorType: 'user', actorId: target.userId }],
      },
      data: {
        status: 'REJECTED',
        decidedBy: ownerId,
        decidedAt: new Date(),
        error: '요청자 내보냄',
      },
    })
    // ponytail: Slack 승인 메시지는 갱신하지 않는다(버튼을 누르면 '이미 처리됨'). 필요하면 id를 받아 syncSlackDecision.
    return { rejectedActions: rejected.count }
  })
  if (!removed) return errorResponse(NOT_FOUND, 404)
  await writeAuditLog(ownerId, 'space.member.remove', 'space_member', target.id, {
    spaceId: target.spaceId,
    userId: target.userId,
    role: target.role,
    rejectedActions: removed.rejectedActions,
  })
  return NextResponse.json({ ok: true })
}
