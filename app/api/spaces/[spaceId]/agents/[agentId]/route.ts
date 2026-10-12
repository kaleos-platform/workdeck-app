/** PATCH — scope·상태·OAuth 클라이언트 바인딩 변경 (Space ADMIN 이상). */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { parseScopes } from '@/lib/agent/identity/principal'

type Ctx = { params: Promise<{ spaceId: string; agentId: string }> }

const patchSchema = z.object({
  scopes: z.array(z.string()).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  oauthClientId: z.string().trim().min(1).max(200).nullable().optional(),
})

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { spaceId, agentId } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error

  const agent = await prisma.spaceAgent.findFirst({
    where: { id: agentId, spaceId },
    select: { id: true, kind: true },
  })
  if (!agent) return errorResponse('에이전트를 찾을 수 없습니다', 404)

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)
  if (parsed.data.oauthClientId && agent.kind !== 'integration') {
    return errorResponse('OAuth 클라이언트는 연동 계정에만 연결할 수 있습니다', 400)
  }
  let scopes
  try {
    scopes = parsed.data.scopes ? parseScopes(parsed.data.scopes) : undefined
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'scope 오류', 400)
  }

  try {
    const updated = await prisma.spaceAgent.update({
      where: { id: agent.id },
      data: { scopes, status: parsed.data.status, oauthClientId: parsed.data.oauthClientId },
      select: { id: true, name: true, kind: true, scopes: true, status: true, oauthClientId: true },
    })
    return NextResponse.json({ agent: updated })
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      return errorResponse('이미 다른 연동 계정에 연결된 OAuth 클라이언트입니다', 409)
    }
    throw err
  }
}
