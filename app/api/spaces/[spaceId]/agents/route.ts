/**
 * /api/spaces/[spaceId]/agents — 에이전트·연동 계정 목록/생성 (Space ADMIN 이상).
 * 토큰 해시는 절대 응답하지 않는다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { requireAal2 } from '@/lib/auth/mfa'
import { writeAuditLog } from '@/lib/admin/auth'
import { parseScopes } from '@/lib/agent/identity/principal'

type Ctx = { params: Promise<{ spaceId: string }> }

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['agent', 'integration']),
  scopes: z.array(z.string()),
  oauthClientId: z.string().trim().min(1).max(200).optional(),
})

const AGENT_SELECT = {
  id: true,
  name: true,
  kind: true,
  scopes: true,
  status: true,
  oauthClientId: true,
  createdAt: true,
  tokens: {
    select: { id: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true },
  },
} as const

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { spaceId } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  const agents = await prisma.spaceAgent.findMany({
    where: { spaceId },
    select: AGENT_SELECT,
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ agents })
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { spaceId } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  const mfa = await requireAal2()
  if (mfa) return mfa

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)
  let scopes
  try {
    scopes = parseScopes(parsed.data.scopes)
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'scope 오류', 400)
  }
  if (parsed.data.oauthClientId && parsed.data.kind !== 'integration') {
    return errorResponse('OAuth 클라이언트는 연동 계정에만 연결할 수 있습니다', 400)
  }

  try {
    const agent = await prisma.spaceAgent.create({
      data: {
        spaceId,
        name: parsed.data.name,
        kind: parsed.data.kind,
        scopes,
        oauthClientId: parsed.data.oauthClientId,
      },
      select: AGENT_SELECT,
    })
    await writeAuditLog(auth.userId, 'space.agent.create', 'space_agent', agent.id, {
      spaceId,
      name: agent.name,
      kind: agent.kind,
      scopes: agent.scopes,
    })
    return NextResponse.json({ agent }, { status: 201 })
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      return errorResponse('이미 있는 이름 또는 OAuth 클라이언트입니다', 409)
    }
    throw err
  }
}
