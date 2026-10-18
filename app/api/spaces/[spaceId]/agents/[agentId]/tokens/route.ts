/** POST — 토큰 발급. 평문은 이 응답에서만 한 번 보여 준다(no-store). 만료 1~365일, 만료 없는 토큰 없음. */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { requireAal2 } from '@/lib/auth/mfa'
import { writeAuditLog } from '@/lib/admin/auth'
import { issueAgentToken, revokeAgentToken } from '@/lib/agent/identity/agent-token'

type Ctx = { params: Promise<{ spaceId: string; agentId: string }> }
const bodySchema = z.object({ expiresInDays: z.number().int().min(1).max(365).optional() })

export async function POST(req: NextRequest, { params }: Ctx) {
  const { spaceId, agentId } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  const mfa = await requireAal2()
  if (mfa) return mfa

  const agent = await prisma.spaceAgent.findFirst({
    where: { id: agentId, spaceId },
    select: { id: true, status: true },
  })
  if (!agent) return errorResponse('에이전트를 찾을 수 없습니다', 404)
  // 비활성 에이전트에 토큰을 미리 발급해 두면 다시 켤 때 함께 살아난다 — 활성 에이전트에만 발급한다.
  if (agent.status !== 'ACTIVE')
    return errorResponse('비활성 에이전트에는 토큰을 발급할 수 없습니다', 409)

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)

  const issued = await issueAgentToken(agent.id, { expiresInDays: parsed.data.expiresInDays })
  // 평문 토큰은 절대 로그에 남기지 않는다. 감사 기록이 실패하면 발급한 토큰을 폐기한다(기록 없는 활성 토큰 금지).
  try {
    await writeAuditLog(auth.userId, 'space.agent.token.issue', 'agent_token', issued.tokenId, {
      spaceId,
      agentId: agent.id,
      expiresAt: issued.expiresAt?.toISOString() ?? null,
    })
  } catch (err) {
    await revokeAgentToken(agent.id, issued.tokenId)
    throw err
  }
  return NextResponse.json(issued, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}
