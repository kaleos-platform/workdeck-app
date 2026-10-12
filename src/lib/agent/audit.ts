import { prisma } from '@/lib/prisma'
import type { Actor } from '@/lib/agent/identity/principal'
import { ToolUserError } from '@/lib/agent/tools/errors'

const SECRET_KEY_RE =
  /token|secret|password|passwd|api[_-]?key|authorization|cookie|refresh|credential|private[_-]?key|access[_-]?key|session|^auth$/i
const MAX_SUMMARY = 1000

/** 문자열 안의 비밀처럼 보이는 값(에이전트 토큰, Bearer 자격, URL·쿼리의 `*token=`·`*secret=`·`*key=`)을 가린다. */
export function maskSecrets(text: string): string {
  return text
    .replace(/wdk_agt_[^\s"'&]*/g, '[redacted]')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/(\w*(?:token|secret|password|key)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/("\w*(?:token|secret|password|key)"\s*:\s*")[^"]*/gi, '$1[redacted]')
}

/** 감사용 인자 요약 — 비밀로 보이는 키는 값 전체를, 문자열 값 안의 비밀은 부분 마스킹하고 길이를 제한한다. */
export function summarizeArgs(args: Record<string, unknown>): string {
  const json = JSON.stringify(args, (key, value) => {
    if (key && SECRET_KEY_RE.test(key)) return '[redacted]'
    if (typeof value === 'string') return maskSecrets(value)
    return value
  })
  return (json ?? '{}').slice(0, MAX_SUMMARY)
}

/** 감사 행 error 칸 — 값 마스킹 뒤 1000자 제한. */
function auditError(error: string | undefined): string | undefined {
  return error === undefined ? undefined : maskSecrets(error).slice(0, MAX_SUMMARY)
}

export const AUDIT_UNAVAILABLE = '감사 기록을 남길 수 없어 실행하지 않았습니다'

export interface ToolAuditStart {
  spaceId: string
  workId: string
  actor: Actor
  requesterUserId: string | null
  tool: string
  args: Record<string, unknown>
  outcome?: 'started' | 'denied'
  error?: string
  actionId?: string
  deciderUserId?: string
}

export interface ToolAuditFinish {
  outcome: 'ok' | 'error'
  error?: string
  durationMs: number
  decryptedCredentialIds: string[]
}

/**
 * 실행 **전** 감사 행을 만든다("모든 호출 기록" 보장).
 * 실패하면 AUDIT_UNAVAILABLE로 throw한다 — 호출자는 도구·액션을 실행하지 않는다.
 */
export async function startToolAudit(e: ToolAuditStart): Promise<string> {
  try {
    const row = await prisma.toolAuditLog.create({
      data: {
        spaceId: e.spaceId,
        workId: e.workId,
        actorType: e.actor.type,
        actorId: e.actor.id,
        requesterUserId: e.requesterUserId,
        tool: e.tool,
        argsSummary: summarizeArgs(e.args),
        outcome: e.outcome ?? 'started',
        error: auditError(e.error),
        durationMs: null,
        decryptedCredentialIds: [],
        actionId: e.actionId ?? null,
        deciderUserId: e.deciderUserId ?? null,
      },
      select: { id: true },
    })
    return row.id
  } catch (err) {
    console.error('[audit] ToolAuditLog 시작 기록 실패', err)
    throw new ToolUserError(AUDIT_UNAVAILABLE)
  }
}

/**
 * 실행 결과를 같은 행에 기록한다. 실패해도 throw하지 않는다 — 외부 쓰기가 이미 끝났을 수 있고,
 * 오류로 바꾸면 호출자가 재시도해 쓰기가 두 번 실행된다. 갱신 실패 행은 "started"로 남는다(결과 미확인).
 */
export async function finishToolAudit(id: string, r: ToolAuditFinish): Promise<void> {
  try {
    await prisma.toolAuditLog.update({
      where: { id },
      data: {
        outcome: r.outcome,
        error: auditError(r.error),
        durationMs: r.durationMs,
        decryptedCredentialIds: r.decryptedCredentialIds,
      },
    })
  } catch (err) {
    console.error('[audit] ToolAuditLog 결과 갱신 실패 — 행은 started로 남는다', id, err)
  }
}
