import { NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { updateMembershipSchema } from '@/lib/validations/admin-users'

// PATCH /api/admin/users/[id]/memberships/[spaceId] — { role }
// OWNER를 강등해서 해당 Space의 OWNER가 0명이 되면 거부
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; spaceId: string }> }
) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { id, spaceId } = await params

  const body = await request.json().catch(() => null)
  const parsed = updateMembershipSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('요청 본문이 올바르지 않습니다', 422, { issues: parsed.error.issues })
  }
  const { role } = parsed.data

  const membership = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId: id } },
  })
  if (!membership) return errorResponse('멤버십을 찾을 수 없습니다', 404)

  if (membership.role === 'OWNER' && role !== 'OWNER') {
    const otherOwnerCount = await prisma.spaceMember.count({
      where: { spaceId, role: 'OWNER', userId: { not: id } },
    })
    if (otherOwnerCount === 0) {
      return errorResponse('이 Space에 남는 OWNER가 없게 되어 역할을 변경할 수 없습니다', 400)
    }
  }

  const updated = await prisma.spaceMember.update({
    where: { spaceId_userId: { spaceId, userId: id } },
    data: { role },
  })

  await writeAuditLog(auth.user.id, 'user.membership.role_change', 'space_member', membership.id, {
    userId: id,
    spaceId,
    fromRole: membership.role,
    toRole: role,
  })

  return NextResponse.json({ membership: updated })
}

// DELETE /api/admin/users/[id]/memberships/[spaceId] — 멤버십 제거
// 마지막 OWNER 제거는 거부
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; spaceId: string }> }
) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { id, spaceId } = await params

  const membership = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId: id } },
  })
  if (!membership) return errorResponse('멤버십을 찾을 수 없습니다', 404)

  if (membership.role === 'OWNER') {
    const otherOwnerCount = await prisma.spaceMember.count({
      where: { spaceId, role: 'OWNER', userId: { not: id } },
    })
    if (otherOwnerCount === 0) {
      return errorResponse('이 Space의 마지막 OWNER는 제거할 수 없습니다', 400)
    }
  }

  await prisma.spaceMember.delete({
    where: { spaceId_userId: { spaceId, userId: id } },
  })

  await writeAuditLog(auth.user.id, 'user.membership.remove', 'space_member', membership.id, {
    userId: id,
    spaceId,
    role: membership.role,
  })

  return NextResponse.json({ ok: true })
}
