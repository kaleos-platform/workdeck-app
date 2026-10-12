/** POST — 토큰 발급. 평문은 이 응답에서만 한 번 보여 준다(no-store). 만료 1~365일, 만료 없는 토큰 없음. */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { issueAgentToken } from '@/lib/agent/identity/agent-token'

type Ctx = { params: Promise<{ spaceId: string; agentId: string }> }
const bodySchema = z.object({ expiresInDays: z.number().int().min(1).max(365).optional() })

export async function POST(req: NextRequest, { params }: Ctx) {
  const { spaceId, agentId } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error

  const agent = await prisma.spaceAgent.findFirst({
    where: { id: agentId, spaceId },
    select: { id: true },
  })
  if (!agent) return errorResponse('에이전트를 찾을 수 없습니다', 404)

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)

  const issued = await issueAgentToken(agent.id, { expiresInDays: parsed.data.expiresInDays })
  return NextResponse.json(issued, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}
