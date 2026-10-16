// GET /api/spaces/members — 현재 Space 구성원과 Slack 연결 상태·승인 한도(ADMIN 이상). Slack 수동 연결에 쓸 memberId 조회용.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { assertRole, resolveRequestedSpaceContext } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  const ctx = await resolveRequestedSpaceContext(req.nextUrl.searchParams.get('spaceId'))
  if ('error' in ctx) return ctx.error
  const roleError = assertRole(ctx.role, 'ADMIN')
  if (roleError) return roleError

  const [members, space] = await Promise.all([
    prisma.spaceMember.findMany({
      where: { spaceId: ctx.space.id },
      select: {
        id: true,
        role: true,
        slackUserId: true,
        user: { select: { email: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.space.findUnique({ where: { id: ctx.space.id }, select: { approvalLimitKrw: true } }),
  ])
  return NextResponse.json({
    spaceId: ctx.space.id,
    myRole: ctx.role,
    members,
    approvalLimitKrw: space?.approvalLimitKrw ?? null,
  })
}
