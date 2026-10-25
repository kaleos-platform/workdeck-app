/**
 * Space별 "에이전트가 wd run으로 ENV 비밀값을 받을 수 있는가" 설정.
 * GET — ADMIN 이상. PATCH — OWNER + fresh aal2(ADMIN_REQUIRE_MFA 우회 없음). 감사는 fail-closed.
 * 응답의 canManage는 호출자가 OWNER인지(UI가 스위치를 보일지 판단).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/api-helpers'
import { requireFreshAal2 } from '@/lib/auth/mfa'
import { prisma } from '@/lib/prisma'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { startToolAudit, finishToolAudit, AUDIT_UNAVAILABLE } from '@/lib/agent/audit'
import { newWorkId } from '@/lib/agent/work-id'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ spaceId: string }> }

// 행은 늦게 만들어지므로 없으면 false.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { spaceId } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  const row = await prisma.spaceAgentSetting.findUnique({
    where: { spaceId },
    select: { envSecretsEnabled: true },
  })
  return NextResponse.json({
    envSecretsEnabled: row?.envSecretsEnabled ?? false,
    canManage: auth.role === 'OWNER',
  })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { spaceId } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  if (auth.role !== 'OWNER') return errorResponse('OWNER만 변경할 수 있습니다', 403)
  const mfaError = await requireFreshAal2()
  if (mfaError) return mfaError

  const parsed = z
    .object({ envSecretsEnabled: z.boolean() })
    .safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)
  const { envSecretsEnabled } = parsed.data

  const startedAt = Date.now()
  let auditId: string
  try {
    auditId = await startToolAudit({
      spaceId,
      workId: newWorkId(),
      actor: { type: 'user', id: auth.userId },
      requesterUserId: null,
      tool: 'space.env_secrets',
      // 키 이름에 'secret'이 들어가면 감사 마스킹(SECRET_KEY_RE)에 가려진다 — on/off가 남도록 enabled로 기록한다.
      args: { enabled: envSecretsEnabled },
    })
  } catch {
    return errorResponse(AUDIT_UNAVAILABLE, 503)
  }
  const finish = (error?: string) =>
    finishToolAudit(auditId, {
      outcome: error ? 'error' : 'ok',
      error,
      durationMs: Date.now() - startedAt,
      decryptedCredentialIds: [],
    })
  try {
    await prisma.spaceAgentSetting.upsert({
      where: { spaceId },
      create: { spaceId, envSecretsEnabled },
      update: { envSecretsEnabled },
    })
  } catch {
    await finish('write_failed')
    return errorResponse('설정을 변경하지 못했습니다', 500)
  }
  await finish()
  return NextResponse.json({ envSecretsEnabled, canManage: true })
}
