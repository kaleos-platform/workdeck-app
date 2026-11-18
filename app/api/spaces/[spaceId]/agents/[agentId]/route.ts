/**
 * PATCH — scope·상태·OAuth 클라이언트 바인딩 변경 (Space ADMIN 이상).
 * 권한을 넓힐 수 있는 변경(scope·ACTIVE·OAuth 바인딩)은 MFA(aal2) 필요, DISABLED만이면 불필요.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { requireAal2 } from '@/lib/auth/mfa'
import { writeAuditLog } from '@/lib/admin/auth'
import { parseScopes } from '@/lib/agent/identity/principal'
import {
  OAUTH_CONSENT_REQUIRED,
  hasActiveOAuthConsent,
} from '@/lib/agent/identity/oauth-client-consent'

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
  if (Object.keys(parsed.data).length === 0) return errorResponse('변경할 항목이 없습니다', 400)
  if (parsed.data.oauthClientId && agent.kind !== 'integration') {
    return errorResponse('OAuth 클라이언트는 연동 계정에만 연결할 수 있습니다', 400)
  }
  let scopes
  try {
    scopes = parsed.data.scopes ? parseScopes(parsed.data.scopes) : undefined
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'scope 오류', 400)
  }
  const { status, oauthClientId } = parsed.data
  if (scopes?.includes('draft:create') && agent.kind !== 'agent') {
    return errorResponse('초안 바로 만들기 권한은 에이전트에만 줄 수 있습니다', 400)
  }
  if (scopes !== undefined || status === 'ACTIVE' || oauthClientId !== undefined) {
    const mfa = await requireAal2()
    if (mfa) return mfa
  }
  // 연결(해제 아님)은 연결하는 ADMIN 본인이 그 클라이언트에 동의했어야 한다 — 남의 클라이언트 선점 방지.
  if (oauthClientId && !(await hasActiveOAuthConsent(auth.userId, oauthClientId))) {
    return errorResponse(OAUTH_CONSENT_REQUIRED, 403)
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // draft:create 부여자 기록 — 행을 잠근 뒤 트랜잭션 안에서 읽은 현재 scopes 와 비교해
      // 새로 들어오면 부여자=저장한 관리자, 빠지면 초기화, 유지면 그대로 둔다(오래된 목록 저장과의 경합 방지).
      let grant = {}
      if (scopes !== undefined) {
        const rows = await tx.$queryRaw<Array<{ scopes: string[] }>>`
          SELECT "scopes" FROM "SpaceAgentIdentity" WHERE "id" = ${agent.id} FOR UPDATE`
        const had = rows[0]?.scopes.includes('draft:create') === true
        const has = scopes.includes('draft:create')
        if (!had && has) {
          grant = { autoExecuteEnabledById: auth.userId, autoExecuteEnabledAt: new Date() }
        } else if (had && !has) {
          grant = { autoExecuteEnabledById: null, autoExecuteEnabledAt: null }
        }
      }
      return tx.spaceAgent.update({
        where: { id: agent.id },
        data: { scopes, status, oauthClientId, ...grant },
        select: {
          id: true,
          name: true,
          kind: true,
          scopes: true,
          status: true,
          oauthClientId: true,
          autoExecuteEnabledById: true,
          autoExecuteEnabledAt: true,
        },
      })
    })
    await writeAuditLog(auth.userId, 'space.agent.update', 'space_agent', agent.id, {
      spaceId,
      changed: Object.keys(parsed.data),
      scopes: updated.scopes,
      status: updated.status,
      oauthClientId: updated.oauthClientId,
    })
    return NextResponse.json({ agent: updated })
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      return errorResponse('이미 다른 연동 계정에 연결된 OAuth 클라이언트입니다', 409)
    }
    throw err
  }
}
