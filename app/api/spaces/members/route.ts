// GET /api/spaces/members — 현재 Space 구성원과 Slack 연결 상태(ADMIN 이상). Slack 수동 연결에 쓸 memberId 조회용.
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { assertRole, resolveSpaceContext } from '@/lib/api-helpers'

export async function GET() {
  const ctx = await resolveSpaceContext()
  if ('error' in ctx && ctx.error) return ctx.error
  const roleError = assertRole(ctx.role, 'ADMIN')
  if (roleError) return roleError

  const members = await prisma.spaceMember.findMany({
    where: { spaceId: ctx.space.id },
    select: {
      id: true,
      role: true,
      slackUserId: true,
      user: { select: { email: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ members })
}
