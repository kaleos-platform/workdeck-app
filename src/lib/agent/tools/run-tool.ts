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
import { resolveRequester, SLACK_USER_RE } from '@/lib/agent/requester'
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
    if (typeof e.tokenId === 'string') principal.tokenId = e.tokenId
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
    ...(principal.tokenId ? { actorTokenId: principal.tokenId } : {}),
    decryptedCredentialIds: [],
  }
}

const SYSTEM_SCOPES = ALL_SCOPES.filter((s) => s !== 'slack:write')

/**
 * Slack 멘션으로 동작하는 workdeck 내장 에이전트의 컨텍스트. 쓰기는 여전히 승인 큐만 거친다.
 * slack:write는 뺀다 — slack_post는 승인 큐를 거치지 않는 예외라, 멘션한 누구나(미확인·외부 발신자 포함)
 * 내장 LLM을 시켜 봇 이름으로 게시하게 할 수 있기 때문이다. slack_post는 SpaceAgent(MCP)만 쓴다.
 */
export function systemToolContext(spaceId: string): McpToolContext {
  return {
    spaceId,
    actor: { type: 'system', id: 'workdeck-agent' },
    scopes: SYSTEM_SCOPES,
    workId: newWorkId(),
    requesterUserId: null,
    requesterSlackUserId: null,
    decryptedCredentialIds: [],
  }
}

/**
 * 컨텍스트에 요청자를 채운다(MCP 라우트·내장 에이전트 공용).
 * Slack 요청자 ID가 오면 그것이 이긴다 — 같은 Space 구성원이면 User.id, 아니면 null(원문 ID는 남긴다).
 * 요청자는 기록용이라 권한을 주지 않는다: 미확인·외부(Slack Connect) 발신자도 쓰기는 승인 큐만 거친다.
 * ID가 없으면 기존 requesterUserId(연동 계정 세션의 구성원)를 그대로 둔다.
 * 구성원 본인 세션(actor=user)은 행위자가 곧 사람이라 요청자를 채우지 않는다.
 */
export async function withRequester(
  ctx: McpToolContext,
  slackUserId: string | null | undefined
): Promise<McpToolContext> {
  // 형식이 틀린 값은 "제공되지 않음" — 쓰레기 값이 확인된 요청자(연동 계정 세션)를 지우지 않게 한다.
  if (!slackUserId || !SLACK_USER_RE.test(slackUserId) || ctx.actor.type === 'user') return ctx
  return { ...ctx, ...(await resolveRequester(ctx.spaceId, slackUserId)) }
}

/** 모든 도구에 공통으로 붙는 메타 인자. 도구 execute에는 전달하지 않는다. */
export const META_ARG_SHAPE = {
  workId: z
    .string()
    .optional()
    .describe(
      '작업 상관 ID. Slack 요청·이전 호출에서 받은 값을 그대로 넘기면 같은 작업으로 묶인다. 없으면 서버가 발급한다.'
    ),
  requesterSlackUserId: z
    .string()
    .optional()
    .describe(
      'Slack에서 요청받은 작업이면 요청한 사람의 Slack 사용자 ID(U로 시작). 서버가 구성원으로 변환해 기록한다.'
    ),
}

export function splitMetaArgs(args: Record<string, unknown>): {
  meta: { workId?: string; requesterSlackUserId?: string }
  toolArgs: Record<string, unknown>
} {
  const { workId, requesterSlackUserId, ...toolArgs } = args
  const normalized = normalizeWorkId(workId)
  return {
    meta: {
      ...(normalized ? { workId: normalized } : {}),
      ...(typeof requesterSlackUserId === 'string' ? { requesterSlackUserId } : {}),
    },
    toolArgs,
  }
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
export function isPrismaError(err: unknown): boolean {
  return PRISMA_ERRORS.some((C) => err instanceof C)
}

function errorSummary(err: unknown): string {
  if (err instanceof ToolUserError) return err.message
  if (isPrismaError(err)) {
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

/** 모든 도구 호출의 단일 관문: scope 검사 → 입력 검증 → 감사 행 생성 → 실행 → 결과 기록. */
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

  // MCP SDK는 등록 스키마로 이미 검증하지만 agent-loop·router는 아니다 — 여기서 한 번 더 같은 스키마로 거른다.
  const parsed = z.object(def.inputSchema).safeParse(args)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(입력)'}: ${i.message}`)
      .join('; ')
    const err = new ToolUserError(`입력값이 올바르지 않습니다 — ${detail}`)
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
    result = await def.execute(ctx, parsed.data)
  } catch (err) {
    await finish('error', errorSummary(err))
    if (err instanceof ToolUserError) throw err
    console.error(`[runTool] ${def.name} 내부 오류`, maskSecrets(errorSummary(err)))
    throw new ToolUserError(TOOL_INTERNAL_ERROR)
  }
  await finish('ok')
  return result
}
