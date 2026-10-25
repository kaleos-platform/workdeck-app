/**
 * POST — wd run용 ENV 발급. 에이전트 토큰(wdk_agt_, secret:env)이 비밀값 이름을 주면 평문 ENV 맵을 준다.
 * 순서: 토큰 → 행위자 종류·scope → Space 설정 → 본문 → 빈도 → 감사 시작(실패 503) → 발급 → 감사 종료.
 * 모든 응답은 no-store이고 오류 응답·감사·로그에는 값을 싣지 않는다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { AGENT_TOKEN_PREFIX, verifyAgentToken } from '@/lib/agent/identity/agent-token'
import {
  startToolAudit,
  finishToolAudit,
  finishToolAuditOrThrow,
  AUDIT_UNAVAILABLE,
} from '@/lib/agent/audit'
import type { McpPrincipal } from '@/lib/agent/identity/principal'
import { newWorkId } from '@/lib/agent/work-id'
import { assertUnderRate, RateLimitedError } from '@/lib/agent/rate'
import {
  SECRET_NAME_RE,
  loadEnvSecretsForIssue,
  recordSecretUsed,
  SecretUnavailableError,
  EnvNameConflictError,
} from '@/lib/agent/secrets/store'

export const runtime = 'nodejs'

const TOOL = 'secret_env_issue'
const NO_STORE = { 'Cache-Control': 'no-store' }
const fail = (message: string, status: number) =>
  NextResponse.json({ message }, { status, headers: NO_STORE })

const bodySchema = z.object({
  secrets: z
    .array(z.string().regex(SECRET_NAME_RE))
    .min(1)
    .max(10)
    .refine((a) => new Set(a).size === a.length),
})

export async function POST(req: NextRequest) {
  const raw = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get('authorization') ?? '')?.[1]
  if (!raw?.startsWith(AGENT_TOKEN_PREFIX)) return fail('인증이 필요합니다', 401)

  let principal: McpPrincipal | null, names: string[]
  try {
    principal = await verifyAgentToken(raw)
    if (!principal) return fail('인증이 필요합니다', 401)
    if (principal.actor.type !== 'agent')
      return fail('wd run은 에이전트 토큰으로만 쓸 수 있습니다', 403)
    if (!principal.scopes.includes('secret:env'))
      return fail('이 토큰에는 secret:env 권한이 없습니다', 403)
    const setting = await prisma.spaceAgentSetting.findUnique({
      where: { spaceId: principal.spaceId },
      select: { envSecretsEnabled: true },
    })
    if (!setting?.envSecretsEnabled)
      return fail('이 Space에서는 wd run 비밀값 발급이 꺼져 있습니다', 403)

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail('입력값이 올바르지 않습니다', 400)
    names = parsed.data.secrets

    await assertUnderRate({
      spaceId: principal.spaceId,
      actorId: principal.actor.id,
      tools: [TOOL],
      limit: 20,
      windowMs: 60_000,
    })
  } catch (e) {
    if (e instanceof RateLimitedError) return fail(e.message, 429)
    console.error('[secrets/env] 발급 전 처리 실패', (e as Error)?.name)
    return fail('요청을 처리하지 못했습니다', 500)
  }

  const startedAt = Date.now()
  let auditId: string
  try {
    auditId = await startToolAudit({
      spaceId: principal.spaceId,
      workId: newWorkId(),
      actor: principal.actor,
      requesterUserId: null,
      tool: TOOL,
      // 키를 secrets로 두면 summarizeArgs가 비밀 키로 보고 이름을 가린다.
      args: { names },
    })
  } catch {
    return fail(AUDIT_UNAVAILABLE, 503)
  }

  // 복호화한 id는 성공·실패 모두 그대로 남긴다(중간 실패여도 복호화는 일어났다).
  const decrypted: string[] = []
  const finish = (error?: string) =>
    finishToolAudit(auditId, {
      outcome: error ? 'error' : 'ok',
      error,
      durationMs: Date.now() - startedAt,
      decryptedCredentialIds: decrypted,
    })

  let rows: Awaited<ReturnType<typeof loadEnvSecretsForIssue>>
  try {
    rows = await loadEnvSecretsForIssue(principal.spaceId, names, principal.actor, decrypted)
  } catch (e) {
    if (e instanceof SecretUnavailableError) {
      await finish(`unavailable:${e.secretName}`)
      return fail(e.message, 403)
    }
    if (e instanceof EnvNameConflictError) {
      await finish('env_name_conflict')
      return fail(e.message, 400)
    }
    // 원문 오류는 싣지 않는다(복호화 오류 등).
    await finish('issue_failed')
    return fail('비밀값을 발급하지 못했습니다', 500)
  }

  // 감사 종료(ok + 복호화 id)가 기록된 것을 확인한 뒤에만 값을 내보낸다.
  try {
    await finishToolAuditOrThrow(auditId, {
      outcome: 'ok',
      durationMs: Date.now() - startedAt,
      decryptedCredentialIds: decrypted,
    })
  } catch {
    await finish('audit_finish_failed')
    return fail(AUDIT_UNAVAILABLE, 503)
  }
  try {
    await Promise.all(rows.map((r) => recordSecretUsed(r.id)))
  } catch {
    // 사용 시각은 부가 정보 — 발급은 막지 않는다. 원문 오류는 싣지 않는다.
    console.error('[secrets/env] 사용 시각 기록 실패')
  }
  const env = Object.fromEntries(rows.map((r) => [r.envName, r.value]))
  return NextResponse.json({ env }, { headers: NO_STORE })
}
