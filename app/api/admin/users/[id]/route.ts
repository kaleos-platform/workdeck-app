import { NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { Prisma } from '@/generated/prisma/client'

// GET /api/admin/users/[id] — 사용자 상세 (Space 멤버십·설치 deck·구독상태·Supabase Auth 상태)
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { id } = await params

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      createdAt: true,
      platformRole: true,
      spaceMemberships: {
        select: {
          role: true,
          createdAt: true,
          space: {
            select: {
              id: true,
              name: true,
              type: true,
              _count: { select: { members: true } },
              deckInstances: {
                where: { isActive: true },
                select: { deckAppId: true },
              },
              subscription: {
                select: {
                  status: true,
                  exemptFlag: true,
                  currentPeriodEnd: true,
                },
              },
            },
          },
        },
      },
    },
  })
  if (!user) return errorResponse('사용자를 찾을 수 없습니다', 404)

  let authInfo: { bannedUntil: string | null; lastSignInAt: string | null } | null = null
  const supabaseAdmin = getSupabaseAdminClient()
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(id)
  if (!error && data?.user) {
    authInfo = {
      bannedUntil: (data.user as { banned_until?: string | null }).banned_until ?? null,
      lastSignInAt: data.user.last_sign_in_at ?? null,
    }
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      isOperator: user.platformRole === 'OPERATOR',
      spaceMemberships: user.spaceMemberships.map((m) => ({
        spaceId: m.space.id,
        spaceName: m.space.name,
        spaceType: m.space.type,
        role: m.role,
        memberCount: m.space._count.members,
        joinedAt: m.createdAt,
        activeDeckAppIds: m.space.deckInstances.map((d) => d.deckAppId),
        subscription: m.space.subscription,
      })),
    },
    auth: authInfo,
  })
}

// DELETE /api/admin/users/[id] — 계정 삭제 (5단계 절차, AdminAuditLog 선기록)
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { id } = await params

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, platformRole: true },
  })
  if (!target) return errorResponse('사용자를 찾을 수 없습니다', 404)

  if (id === auth.user.id) {
    return errorResponse('본인 계정은 어드민에서 삭제할 수 없습니다', 400)
  }
  if (target.platformRole === 'OPERATOR') {
    return errorResponse(
      '운영자 계정은 어드민에서 변경할 수 없습니다. scripts/grant-operator.mjs로 권한을 회수한 뒤 처리하세요.',
      400
    )
  }

  const memberships = await prisma.spaceMember.findMany({
    where: { userId: id },
    select: {
      role: true,
      space: {
        select: {
          id: true,
          name: true,
          _count: { select: { members: true } },
        },
      },
    },
  })

  // 1) 유일 OWNER이면서 멤버 2인 이상인 Space가 있으면 거부 — 소유권 이양 필요
  //    "유일 OWNER" 여부는 해당 Space의 OWNER 수를 실제로 세어 판정한다(본인 제외 OWNER 0명).
  const ownerCandidateSpaces = memberships.filter(
    (m) => m.role === 'OWNER' && m.space._count.members >= 2
  )
  const blockingSpaces: { id: string; name: string }[] = []
  await Promise.all(
    ownerCandidateSpaces.map(async (m) => {
      const otherOwnerCount = await prisma.spaceMember.count({
        where: { spaceId: m.space.id, role: 'OWNER', userId: { not: id } },
      })
      if (otherOwnerCount === 0) {
        blockingSpaces.push({ id: m.space.id, name: m.space.name })
      }
    })
  )
  if (blockingSpaces.length > 0) {
    return errorResponse(
      '이 사용자가 유일한 소유자(OWNER)인 Space가 있어 삭제할 수 없습니다. 먼저 소유권을 이양하세요.',
      400,
      { blockingSpaces }
    )
  }

  // 2) 유일 멤버인 Space는 삭제 대상 (cascade로 DeckInstance/구독/청구 등 연쇄 삭제)
  const soloSpaceIds = memberships
    .filter((m) => m.space._count.members === 1)
    .map((m) => m.space.id)

  // ReorderPlan.createdBy는 onDelete: Restrict(prisma/schema.prisma) — 삭제되지 않고 남는 Space
  // (= solo가 아닌 Space)에 이 사용자가 만든 발주 계획이 있으면 user.delete가 FK 위반으로 실패한다.
  // 데이터를 임의로 지우거나 이관하지 않고 사전 검증으로 거부한다.
  const blockingReorderPlans = await prisma.reorderPlan.findMany({
    where:
      soloSpaceIds.length > 0
        ? { createdById: id, spaceId: { notIn: soloSpaceIds } }
        : { createdById: id },
    select: { id: true, spaceId: true, space: { select: { name: true } } },
  })
  if (blockingReorderPlans.length > 0) {
    return errorResponse(
      '이 사용자가 다른 Space에 남긴 발주 계획이 있어 삭제할 수 없습니다. 해당 발주 계획을 먼저 정리하거나 다른 담당자로 이관하세요.',
      400,
      {
        blockingReorderPlans: blockingReorderPlans.map((p) => ({
          id: p.id,
          spaceId: p.spaceId,
          spaceName: p.space.name,
        })),
      }
    )
  }

  // 2)(3) 하나의 트랜잭션으로: solo Space 삭제 + User 삭제 (Workspace/잔여 SpaceMember cascade)
  // HiringPostingPosition.spaceId는 onDelete: Restrict라 Space 자신이 지워질 때 먼저 정리해야
  // space.deleteMany가 FK 위반으로 실패하지 않는다(이 데이터는 어차피 지워질 Space 소속이라 보존할 이유가 없음).
  try {
    await prisma.$transaction(async (tx) => {
      if (soloSpaceIds.length > 0) {
        await tx.hiringPostingPosition.deleteMany({ where: { spaceId: { in: soloSpaceIds } } })
        await tx.space.deleteMany({ where: { id: { in: soloSpaceIds } } })
      }
      await tx.user.delete({ where: { id } })
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      return errorResponse(
        '알려지지 않은 참조 제약(FK)에 걸려 삭제할 수 없습니다. 해당 데이터를 먼저 정리하세요.',
        409,
        { prismaCode: e.code, fkField: e.meta?.field_name ?? e.meta?.constraint ?? null }
      )
    }
    throw e
  }

  // 5) AuditLog는 트랜잭션 성공 이후 기록 — actorUserId는 FK가 없어 대상 유저 삭제 후에도 기록 가능
  await writeAuditLog(auth.user.id, 'user.delete', 'user', id, {
    email: target.email,
    deletedSpaceIds: soloSpaceIds,
  })

  // 4) DB 성공 후 Supabase Auth 삭제 — 실패해도 DB 삭제는 되돌리지 않음
  const supabaseAdmin = getSupabaseAdminClient()
  const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(id)
  if (authDeleteError) {
    return NextResponse.json(
      {
        message: 'DB 삭제는 완료되었으나 Supabase Auth 계정 삭제에 실패했습니다. 수동 확인이 필요합니다.',
        authError: authDeleteError.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, deletedSpaceIds: soloSpaceIds })
}
