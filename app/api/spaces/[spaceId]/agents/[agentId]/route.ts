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
import { computeWriteGrants } from '@/lib/agent/identity/write-grants'
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
  if (scopes !== undefined || status === 'ACTIVE' || oauthClientId !== undefined) {
    const mfa = await requireAal2({ ignoreUserFlag: true })
    if (mfa) return mfa
  }
  // 연결(해제 아님)은 연결하는 ADMIN 본인이 그 클라이언트에 동의했어야 한다 — 남의 클라이언트 선점 방지.
  if (oauthClientId && !(await hasActiveOAuthConsent(auth.userId, oauthClientId))) {
    return errorResponse(OAUTH_CONSENT_REQUIRED, 403)
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // 쓰기 권한 부여자 기록 — 행을 잠근 뒤 트랜잭션 안에서 읽은 현재 기록과 합쳐 계산한다
      // (오래된 목록 저장·동시 저장과의 경합 방지). 같은 목록 재저장도 허용 — 기록 없는 쓰기 scope 는 새로 채워진다.
      let grant = {}
      if (scopes !== undefined) {
        const rows = await tx.$queryRaw<Array<{ writeGrants: unknown }>>`
          SELECT "writeGrants" FROM "SpaceAgentIdentity" WHERE "id" = ${agent.id} FOR UPDATE`
        // 기록된 부여자가 아직 ADMIN 이상인지 — 탈퇴·강등이면 이번에 저장하는 관리자로 다시 기록한다.
        const prevGrants = (rows[0]?.writeGrants ?? {}) as Record<string, { userId?: string }>
        const grantorIds = [...new Set(Object.values(prevGrants).map((g) => g?.userId))].filter(
          (x): x is string => typeof x === 'string'
        )
        const stillAdmin = grantorIds.length
          ? await tx.spaceMember.findMany({
              where: { spaceId, userId: { in: grantorIds }, role: { in: ['ADMIN', 'OWNER'] } },
              select: { userId: true },
            })
          : []
        grant = {
          writeGrants: computeWriteGrants(
            rows[0]?.writeGrants,
            scopes,
            auth.userId,
            new Date(),
            new Set(stillAdmin.map((m) => m.userId))
          ) as object,
          scopesVersion: { increment: 1 },
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
          writeGrants: true,
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
