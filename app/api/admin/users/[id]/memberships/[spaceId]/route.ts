import { NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { addMembershipSchema, updateMembershipSchema } from '@/lib/validations/admin-users'

// POST /api/admin/users/[id]/memberships/[spaceId] — { role: ADMIN|MEMBER } 기존 사용자를 조직 Space 구성원으로 추가
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; spaceId: string }> }
) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { id, spaceId } = await params
  const body = await request.json().catch(() => null)
  const parsed = addMembershipSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('요청 본문이 올바르지 않습니다', 422, { issues: parsed.error.issues })
  }
  const { role } = parsed.data

  const [user, space] = await Promise.all([
    prisma.user.findUnique({ where: { id }, select: { id: true } }),
    prisma.space.findUnique({ where: { id: spaceId }, select: { id: true, type: true } }),
  ])
  if (!user) return errorResponse('사용자를 찾을 수 없습니다', 404)
  if (!space) return errorResponse('Space를 찾을 수 없습니다', 404)

  const existing = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId: id } },
  })
  if (existing) return errorResponse('이미 이 Space의 구성원입니다(역할 변경을 쓰세요)', 409)

  // ponytail: 동시 요청 시 create가 P2002를 던져 500 — 운영자 1명 화면이라 허용, 필요하면 P2002를 409로 매핑
  const membership = await prisma.spaceMember.create({ data: { spaceId, userId: id, role } })
  // 개인 Space에 구성원을 넣으면 팀 Space로 전환한다(초대 경로와 같은 규칙).
  if (space.type === 'PERSONAL') {
    const { count } = await prisma.space.updateMany({
      where: { id: spaceId, type: 'PERSONAL' },
      data: { type: 'ORGANIZATION' },
    })
    if (count > 0)
      await writeAuditLog(auth.user.id, 'space.type.convert', 'space', spaceId, {
        from: 'PERSONAL',
        to: 'ORGANIZATION',
        via: 'admin.membership.add',
      })
  }
  await writeAuditLog(auth.user.id, 'user.membership.add', 'space_member', membership.id, {
    userId: id,
    spaceId,
    role,
  })
  return NextResponse.json({ membership }, { status: 201 })
}

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
