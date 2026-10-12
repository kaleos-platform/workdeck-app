import {
  ALL_SCOPES,
  parseScopes,
  type Actor,
  type McpPrincipal,
} from '@/lib/agent/identity/principal'
import { newWorkId } from '@/lib/agent/work-id'
import type { McpToolContext, ToolDefinition } from './types'

export class ToolScopeError extends Error {
  constructor(scope: string) {
    super(`권한(scope)이 없습니다: ${scope}`)
    this.name = 'ToolScopeError'
  }
}

/** withMcpAuth가 넣은 AuthInfo.extra를 검증해 principal로 바꾼다(verifyToken 결과와 짝). */
export function readAuthExtra(
  extra: unknown
): { ok: true; principal: McpPrincipal } | { ok: false; reason: string } {
  const e = (extra ?? {}) as Record<string, unknown>
  if (typeof e.authError === 'string') return { ok: false, reason: e.authError }
  const actor = e.actor as Actor | undefined
  if (
    typeof e.spaceId !== 'string' ||
    !actor ||
    typeof actor.id !== 'string' ||
    typeof actor.type !== 'string'
  ) {
    return { ok: false, reason: '인증 정보가 없습니다' }
  }
  try {
    return { ok: true, principal: { spaceId: e.spaceId, actor, scopes: parseScopes(e.scopes) } }
  } catch {
    return { ok: false, reason: '인증 정보가 없습니다' }
  }
}

export function buildToolContext(
  principal: McpPrincipal,
  meta: { workId?: string }
): McpToolContext {
  return {
    spaceId: principal.spaceId,
    actor: principal.actor,
    scopes: principal.scopes,
    workId: meta.workId ?? newWorkId(),
    requesterUserId: null,
    requesterSlackUserId: null,
    decryptedCredentialIds: [],
  }
}

/** Slack 멘션으로 동작하는 workdeck 내장 에이전트의 컨텍스트. 쓰기는 여전히 승인 큐만 거친다. */
export function systemToolContext(
  spaceId: string,
  opts?: { requesterSlackUserId?: string | null }
): McpToolContext {
  return {
    spaceId,
    actor: { type: 'system', id: 'workdeck-agent' },
    scopes: ALL_SCOPES,
    workId: newWorkId(),
    requesterUserId: null,
    requesterSlackUserId: opts?.requesterSlackUserId ?? null,
    decryptedCredentialIds: [],
  }
}

/** 모든 도구 호출의 단일 관문: scope 검사 → 실행. (Task 6에서 감사 기록이 여기 붙는다) */
export async function runTool(
  def: ToolDefinition,
  ctx: McpToolContext,
  args: Record<string, unknown>
): Promise<unknown> {
  if (def.scope && !ctx.scopes.includes(def.scope)) throw new ToolScopeError(def.scope)
  return def.execute(ctx, args)
}
