// PUT /api/spaces/members/:memberId/slack-link — ADMIN 이상이 자기 Slack 연결을 지정하거나 구성원의 연결을 해제한다.
// body: { slackUserId: "U…" | null }. 같은 Space 안에서 Slack 사용자 1명은 구성원 1명에만 연결된다.
// OWNER 구성원의 연결은 그 OWNER 본인만 바꾼다 — ADMIN·다른 OWNER 가 OWNER 연결을 자기 Slack ID 로 바꿔 지출 제안을 승인하는 우회를 막는다.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { assertRole, errorResponse, resolveSpaceContext } from '@/lib/api-helpers'

const bodySchema = z.object({
  slackUserId: z
    .string()
    .regex(/^[UW][A-Z0-9]{4,}$/)
    .nullable(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const ctx = await resolveSpaceContext()
  if ('error' in ctx && ctx.error) return ctx.error
  const roleError = assertRole(ctx.role, 'ADMIN')
  if (roleError) return roleError

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success)
    return errorResponse('slackUserId 형식이 올바르지 않습니다(U… 또는 null)', 400)

  const { memberId } = await params
  const member = await prisma.spaceMember.findFirst({
    where: { id: memberId, spaceId: ctx.space.id },
    select: { id: true, role: true, userId: true },
  })
  if (!member) return errorResponse('구성원을 찾을 수 없습니다', 404)
  if (member.role === 'OWNER' && member.userId !== ctx.user.id) {
    return errorResponse('OWNER 구성원의 Slack 연결은 본인만 바꿀 수 있습니다', 403)
  }
  // 다른 구성원 기록은 해제만 — 남의 기록에 임의 Slack ID 를 붙이면 그 Slack 사용자가 그 구성원으로 승인한다.
  // 다른 구성원은 이메일 자동 연결(member-link)이나 본인 지정으로 연결된다.
  if (parsed.data.slackUserId !== null && member.userId !== ctx.user.id) {
    return errorResponse('다른 구성원의 Slack 연결은 해제만 할 수 있습니다', 403)
  }

  try {
    const updated = await prisma.spaceMember.update({
      where: { id: member.id },
      data: { slackUserId: parsed.data.slackUserId },
      select: { id: true, slackUserId: true },
    })
    return NextResponse.json({ member: updated })
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') {
      return errorResponse('이미 다른 구성원과 연결된 Slack 사용자입니다', 409)
    }
    throw e
  }
}
