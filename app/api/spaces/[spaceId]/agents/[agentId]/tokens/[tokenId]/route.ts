/** DELETE — 토큰 폐기. 즉시 401이 된다(verifyAgentToken이 revokedAt 확인). */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { revokeAgentToken } from '@/lib/agent/identity/agent-token'

type Ctx = { params: Promise<{ spaceId: string; agentId: string; tokenId: string }> }

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { spaceId, agentId, tokenId } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  const agent = await prisma.spaceAgent.findFirst({
    where: { id: agentId, spaceId },
    select: { id: true },
  })
  if (!agent) return errorResponse('에이전트를 찾을 수 없습니다', 404)
  const ok = await revokeAgentToken(agent.id, tokenId)
  if (!ok) return errorResponse('토큰을 찾을 수 없거나 이미 폐기되었습니다', 404)
  return NextResponse.json({ ok: true })
}
