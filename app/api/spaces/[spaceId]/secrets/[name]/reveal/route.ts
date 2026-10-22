/**
 * POST — 비밀값 보기(ADMIN 이상 + 실제 MFA aal2, 비상 해제 무시). 평문이 서버 밖으로 나가는 유일한 경로라
 * 감사 행을 먼저 남기고(실패하면 503, 값 없음) 복호화한 비밀값 id를 결과에 기록한다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api-helpers'
import { requireFreshAal2 } from '@/lib/auth/mfa'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { startToolAudit, finishToolAudit, AUDIT_UNAVAILABLE } from '@/lib/agent/audit'
import { newWorkId } from '@/lib/agent/work-id'
import { revealSecretValue } from '@/lib/agent/secrets/store'

type Ctx = { params: Promise<{ spaceId: string; name: string }> }

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { spaceId, name } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  // MFA 비상 해제가 켜져 있어도 열지 않는다(spec §2).
  const mfaError = await requireFreshAal2()
  if (mfaError) return mfaError

  const startedAt = Date.now()
  let auditId: string
  try {
    auditId = await startToolAudit({
      spaceId,
      workId: newWorkId(),
      actor: { type: 'user', id: auth.userId },
      requesterUserId: null,
      tool: 'secret.reveal',
      args: { name },
    })
  } catch {
    return errorResponse(AUDIT_UNAVAILABLE, 503)
  }

  const finish = (outcome: 'ok' | 'error', ids: string[], error?: string) =>
    finishToolAudit(auditId, {
      outcome,
      error,
      durationMs: Date.now() - startedAt,
      decryptedCredentialIds: ids,
    })

  try {
    const revealed = await revealSecretValue(spaceId, name)
    if (!revealed) {
      await finish('error', [], 'not_found')
      return errorResponse('비밀값을 찾을 수 없습니다', 404)
    }
    await finish('ok', ['secret:' + revealed.id])
    return NextResponse.json(
      { value: revealed.value },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    // 복호화 실패 등 — 원문 오류는 싣지 않는다.
    await finish('error', [], 'decrypt_failed')
    return errorResponse('비밀값을 보여줄 수 없습니다', 500)
  }
}
