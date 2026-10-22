/**
 * PUT — 비밀값 등록·교체, DELETE — 삭제(ADMIN 이상 + MFA aal2). 본문은 권한·MFA 검사 뒤에 읽는다.
 * 평문은 요청 본문으로만 받고 응답에 돌려주지 않는다. 이 단계에서는 API_KEY만 받는다.
 * 감사는 reveal과 같이 fail-closed — 시작 행을 못 남기면 503이고 쓰지 않는다. args에 값은 없다.
 */
import { isDeepStrictEqual } from 'node:util'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/api-helpers'
import { requireAal2 } from '@/lib/auth/mfa'
import { prisma } from '@/lib/prisma'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { startToolAudit, finishToolAudit, AUDIT_UNAVAILABLE } from '@/lib/agent/audit'
import { newWorkId } from '@/lib/agent/work-id'
import { apiKeyConfigSchema } from '@/lib/agent/secrets/config'
import {
  SECRET_NAME_RE,
  deleteSecret,
  findSecretForUpdate,
  saveApiKeySecret,
} from '@/lib/agent/secrets/store'

type Ctx = { params: Promise<{ spaceId: string; name: string }> }

/** 감사 행을 남기고 run을 실행한다. 시작 기록 실패면 503(run 호출 안 함), run이 throw하면 500. */
async function audited(
  spaceId: string,
  userId: string,
  tool: 'secret.put' | 'secret.delete',
  args: Record<string, unknown>,
  run: () => Promise<{ res: Response; error?: string }>
): Promise<Response> {
  const startedAt = Date.now()
  let auditId: string
  try {
    auditId = await startToolAudit({
      spaceId,
      workId: newWorkId(),
      actor: { type: 'user', id: userId },
      requesterUserId: null,
      tool,
      args,
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
    const { res, error } = await run()
    await finish(error)
    return res
  } catch {
    await finish('write_failed')
    return errorResponse('비밀값을 변경하지 못했습니다', 500)
  }
}

const VALUE_RULE = '값은 공백 없는 영문·숫자·기호(ASCII) 8~4096자여야 합니다'

const bodySchema = z.object({
  // 헤더·query에 그대로 실리므로 출력 가능한 ASCII만(공백·제어문자·비ASCII 거부). 메시지에 값을 싣지 않는다.
  value: z
    .string()
    .min(8, VALUE_RULE)
    .max(4096, VALUE_RULE)
    .regex(/^[\x21-\x7e]+$/, VALUE_RULE),
  config: apiKeyConfigSchema,
  allowedAgentIds: z.array(z.string()).max(100),
})

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { spaceId, name } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  const mfaError = await requireAal2()
  if (mfaError) return mfaError

  if (!SECRET_NAME_RE.test(name)) return errorResponse('이름이 올바르지 않습니다', 400)
  const raw = await req.json().catch(() => null)
  // kind를 먼저 본다 — LOGIN·ENV는 config 모양이 달라 스키마 오류가 아니라 이 안내를 받아야 한다.
  if ((raw as { kind?: unknown } | null)?.kind !== 'API_KEY') {
    return errorResponse('이 단계에서는 API_KEY만 등록할 수 있습니다', 400)
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    // 경로·메시지만 싣는다(입력값 자체는 싣지 않는다). value 오류는 고정 문구.
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => (i.path[0] === 'value' ? VALUE_RULE : `${i.path.join('.')}: ${i.message}`))
      .join('; ')
    return errorResponse(`입력값이 올바르지 않습니다 — ${detail}`, 400)
  }
  const { value, config } = parsed.data

  const existing = await findSecretForUpdate(spaceId, name)
  if (existing && existing.kind !== 'API_KEY') {
    return errorResponse('종류는 바꿀 수 없습니다. 삭제 후 다시 등록하세요', 409)
  }

  const allowedAgentIds = [...new Set(parsed.data.allowedAgentIds)]
  if (allowedAgentIds.length > 0) {
    const found = await prisma.spaceAgent.count({
      where: { spaceId, status: 'ACTIVE', id: { in: allowedAgentIds } },
    })
    if (found !== allowedAgentIds.length) {
      return errorResponse('이 Space의 에이전트만 허용할 수 있습니다', 400)
    }
  }

  // value는 매번 새로 암호화되고 revision이 오르므로 항상 변경으로 본다(비교하려고 복호화하지 않는다).
  const changed = existing
    ? [
        'value',
        ...(isDeepStrictEqual(existing.config, config) ? [] : ['config']),
        ...(isDeepStrictEqual([...existing.allowedAgentIds].sort(), [...allowedAgentIds].sort())
          ? []
          : ['allowedAgentIds']),
      ]
    : ['value', 'config', 'allowedAgentIds']

  return audited(
    spaceId,
    auth.userId,
    'secret.put',
    { name, created: !existing, changed },
    async () => {
      const saved = await saveApiKeySecret(
        spaceId,
        name,
        value,
        config,
        allowedAgentIds,
        auth.userId
      )
      return {
        res: NextResponse.json(
          { name, revision: saved.revision },
          { headers: { 'Cache-Control': 'no-store' } }
        ),
      }
    }
  )
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { spaceId, name } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  const mfaError = await requireAal2()
  if (mfaError) return mfaError

  return audited(spaceId, auth.userId, 'secret.delete', { name }, async () =>
    (await deleteSecret(spaceId, name))
      ? { res: new NextResponse(null, { status: 204 }) }
      : { res: errorResponse('비밀값을 찾을 수 없습니다', 404), error: 'not_found' }
  )
}
