import {
  ALL_SCOPES,
  parseScopes,
  type Actor,
  type McpPrincipal,
} from '@/lib/agent/identity/principal'
import { z } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import { finishToolAudit, maskSecrets, startToolAudit } from '@/lib/agent/audit'
import { ToolUserError } from './errors'
import { newWorkId, normalizeWorkId } from '@/lib/agent/work-id'
import type { McpToolContext, ToolDefinition } from './types'

export class ToolScopeError extends ToolUserError {
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
    const principal: McpPrincipal = { spaceId: e.spaceId, actor, scopes: parseScopes(e.scopes) }
    if (typeof e.requesterUserId === 'string') principal.requesterUserId = e.requesterUserId
    return { ok: true, principal }
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
    requesterUserId: principal.requesterUserId ?? null,
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

/** 모든 도구에 공통으로 붙는 메타 인자. 도구 execute에는 전달하지 않는다. */
export const META_ARG_SHAPE = {
  workId: z
    .string()
    .optional()
    .describe(
      '작업 상관 ID. Slack 요청·이전 호출에서 받은 값을 그대로 넘기면 같은 작업으로 묶인다. 없으면 서버가 발급한다.'
    ),
}

export function splitMetaArgs(args: Record<string, unknown>): {
  meta: { workId?: string }
  toolArgs: Record<string, unknown>
} {
  const { workId, ...toolArgs } = args
  const normalized = normalizeWorkId(workId)
  return { meta: normalized ? { workId: normalized } : {}, toolArgs }
}

export const TOOL_INTERNAL_ERROR = '도구 실행 중 내부 오류가 발생했습니다'

const PRISMA_ERRORS = [
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientRustPanicError,
]

/**
 * 감사 행에 남길 오류 요약. 도메인 오류(ToolUserError)는 메시지, 그 밖은 `종류: 메시지`(마스킹은 audit.ts).
 * Prisma 오류는 메시지에 쿼리·인자가 섞이므로 종류·코드만 남긴다.
 */
function errorSummary(err: unknown): string {
  if (err instanceof ToolUserError) return err.message
  if (PRISMA_ERRORS.some((C) => err instanceof C)) {
    const code = (err as { code?: unknown }).code
    return `${(err as Error).name}${typeof code === 'string' ? ` ${code}` : ''}`
  }
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}

/** 도구 호출 경로(MCP route·Slack router·agent-loop)의 사용자 노출 문구 — 도메인 오류만 원문, 나머지는 일반 문구. */
export function toolErrorMessage(err: unknown): string {
  if (err instanceof ToolUserError) return err.message
  // runTool 밖(결과 포맷 등)에서 난 오류 — runTool 안의 오류는 이미 로그를 남기고 ToolUserError로 바뀌어 온다.
  console.error('[tool] 내부 오류', maskSecrets(errorSummary(err)))
  return TOOL_INTERNAL_ERROR
}

/** 모든 도구 호출의 단일 관문: scope 검사 → 감사 행 생성 → 실행 → 결과 기록. */
export async function runTool(
  def: ToolDefinition,
  ctx: McpToolContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const base = {
    spaceId: ctx.spaceId,
    workId: ctx.workId,
    actor: ctx.actor,
    requesterUserId: ctx.requesterUserId,
    tool: def.name,
    args,
  }

  if (def.scope && !ctx.scopes.includes(def.scope)) {
    const err = new ToolScopeError(def.scope)
    // 거부는 실행이 없으므로 기록 실패가 거부 결과를 바꾸지 않는다.
    await startToolAudit({ ...base, outcome: 'denied', error: err.message }).catch(() => undefined)
    throw err
  }

  // 감사 행을 먼저 만든다. 못 만들면 AUDIT_UNAVAILABLE로 throw — 도구를 실행하지 않는다.
  const auditId = await startToolAudit(base)
  const started = Date.now()
  const finish = (outcome: 'ok' | 'error', error?: string) =>
    finishToolAudit(auditId, {
      outcome,
      error,
      durationMs: Date.now() - started,
      decryptedCredentialIds: ctx.decryptedCredentialIds,
    }).catch(() => undefined) // 계약상 throw하지 않지만, 결과 기록 실패가 실행 결과를 바꾸지 않게 한 번 더 막는다

  let result: unknown
  try {
    result = await def.execute(ctx, args)
  } catch (err) {
    await finish('error', errorSummary(err))
    if (err instanceof ToolUserError) throw err
    console.error(`[runTool] ${def.name} 내부 오류`, maskSecrets(errorSummary(err)))
    throw new ToolUserError(TOOL_INTERNAL_ERROR)
  }
  await finish('ok')
  return result
}
