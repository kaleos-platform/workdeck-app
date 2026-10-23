import { z } from 'zod'
import { createPendingAction } from '@/lib/agent/actions/create'
import { displayUrl, matchReadOp, normalizePath } from '@/lib/agent/secrets/config'
import { buildRequest, filterResponse } from '@/lib/agent/secrets/call'
import { SecretHttpError, secretRequest } from '@/lib/agent/secrets/http-client'
import {
  assertSecretUsable,
  loadSecretForUse,
  recordSecretError,
  recordSecretUsed,
} from '@/lib/agent/secrets/store'
import { assertUnderRate, RateLimitedError } from '@/lib/agent/rate'
import { ToolUserError } from './errors'
import type { ToolDefinition } from './types'

const secretName = z.string().min(1).max(63).describe('비밀값 이름(키 값이 아니라 이름만)')
const path = z.string().min(1).max(500).describe('업스트림 경로. `/`로 시작')
const query = z.record(z.string(), z.string()).optional()

const RATE_WINDOW_MS = 60_000
// runTool이 감사 시작 행을 handler 전에 쓰므로 이번 호출도 세어진다 → limit+1로 "분당 N회 허용".
async function underRate(actorId: string, tool: string, perMinute: number) {
  try {
    await assertUnderRate({
      actorId,
      tools: [tool],
      limit: perMinute + 1,
      windowMs: RATE_WINDOW_MS,
    })
  } catch (err) {
    if (err instanceof RateLimitedError)
      throw new ToolUserError('호출이 너무 많습니다. 잠시 후 다시 시도하세요')
    throw err
  }
}

const httpRead: ToolDefinition = {
  name: 'secret_http_read',
  description:
    '등록된 API 키로 외부 API를 조회합니다. 등록된 조회 operation만 바로 실행. 그 밖은 secret_http_propose로 제안 → OWNER 승인. 키 값은 보이지 않고 허용된 응답 필드만 돌려줍니다. op에는 operation id만 넣습니다(목록은 관리자에게 문의).',
  inputSchema: {
    secret: secretName,
    op: z.string().min(1).max(100).describe('등록된 조회 operation id'),
    path,
    query,
    body: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  },
  mode: 'read',
  scope: 'secret:read',
  async execute(ctx, p) {
    await underRate(ctx.actor.id, 'secret_http_read', 60)
    const sec = await loadSecretForUse(
      ctx.spaceId,
      p.secret as string,
      ctx.actor,
      ctx.decryptedCredentialIds
    )
    const opId = p.op as string
    const method = sec.config.readOps.find((o) => o.id === opId)?.method
    // 등록 밖 op도 matchReadOp와 같은 메시지로 거부한다.
    const op = matchReadOp(sec.config, {
      op: opId,
      method: method ?? '',
      path: p.path as string,
      query: (p.query as Record<string, string> | undefined) ?? {},
      body: p.body as Record<string, unknown> | undefined,
    })
    const req = buildRequest(sec.value, sec.config, {
      method: op.method,
      path: p.path as string,
      query: (p.query as Record<string, string> | undefined) ?? {},
      body: p.body as Record<string, unknown> | undefined,
    })
    let res
    try {
      res = await secretRequest({ ...req, method: op.method })
    } catch (err) {
      if (!(err instanceof SecretHttpError)) throw err
      await recordSecretError(sec.id, err.code)
      throw new ToolUserError(`외부 API 호출 실패: ${err.code} (${opId})`)
    }
    if (res.status >= 400) {
      await recordSecretError(sec.id, `HTTP ${res.status}`)
      throw new ToolUserError(`외부 API 오류: HTTP ${res.status} (${opId})`)
    }
    await recordSecretUsed(sec.id)
    return filterResponse(op, res, sec.value)
  },
}

const httpPropose: ToolDefinition = {
  name: 'secret_http_propose',
  description:
    '등록된 API 키로 외부 API를 호출하는 요청을 제안합니다. 즉시 실행되지 않고 승인 대기 큐에 등록되며, OWNER가 승인한 뒤에만 호출합니다. 승인 실행 결과는 상태 코드만 돌려줍니다. 등록된 조회 operation은 secret_http_read로 바로 실행하세요.',
  inputSchema: {
    secret: secretName,
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path,
    query,
    body: z.record(z.string(), z.unknown()).optional(),
    summary: z.string().min(1).max(300),
  },
  mode: 'write',
  scope: 'secret:write',
  async execute(ctx, p) {
    await underRate(ctx.actor.id, 'secret_http_propose', 20)
    const { id, revision, baseUrl } = await assertSecretUsable(
      ctx.spaceId,
      p.secret as string,
      ctx.actor
    )
    const path = normalizePath(p.path as string)
    return createPendingAction({
      spaceId: ctx.spaceId,
      actionType: 'secret.http.request',
      params: {
        secretId: id,
        secretName: p.secret,
        // 승인 화면·Slack 표시용 — maskParams가 secret* 키를 가리므로 가려지지 않는 키로 한 번 더 싣는다.
        target: p.secret,
        url: displayUrl(baseUrl, path),
        revision,
        method: p.method,
        path,
        query: p.query,
        body: p.body,
      },
      summary: p.summary as string,
      source: 'MCP',
      actor: ctx.actor,
      requesterUserId: ctx.requesterUserId,
      requesterSlackUserId: ctx.requesterSlackUserId,
      workId: ctx.workId,
      actorTokenId: ctx.actorTokenId,
    })
  },
}

export const secretTools: ToolDefinition[] = [httpRead, httpPropose]
