import { z } from 'zod'
import { normalizePath } from '@/lib/agent/secrets/config'
import { buildRequest, filterResponse } from '@/lib/agent/secrets/call'
import { SecretHttpError, secretRequest } from '@/lib/agent/secrets/http-client'
import {
  assertSecretUsable,
  loadSecretForApproval,
  recordSecretError,
  recordSecretUsed,
} from '@/lib/agent/secrets/store'
import { ToolUserError } from '@/lib/agent/tools/errors'
import type { ActionDefinition } from './types'

const paramsSchema = z.object({
  secretId: z.string().min(1),
  secretName: z.string().min(1),
  revision: z.number().int(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().min(1),
  query: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
})
type Params = z.infer<typeof paramsSchema>

const secretHttpRequest: ActionDefinition<Params> = {
  actionType: 'secret.http.request',
  deckKey: 'secrets',
  title: '외부 API 요청(비밀값 사용)',
  paramsSchema,
  requiredRole: 'OWNER',
  expiryHours: 24,
  validateCreate: async (ctx, p) => {
    normalizePath(p.path)
    const { id, revision } = await assertSecretUsable(ctx.spaceId, p.secretName, ctx.actor)
    if (id !== p.secretId || revision !== p.revision)
      throw new ToolUserError('비밀값이 바뀌었습니다. 다시 제안하세요')
  },
  // 제안 시점의 비밀값 메타(값 없음) — 승인 화면·감사용.
  snapshot: async (_ctx, p) => ({ secretName: p.secretName, revision: p.revision }),
  execute: async (ctx, p) => {
    const sec = await loadSecretForApproval(
      ctx.spaceId,
      p.secretId,
      p.revision,
      ctx.actor,
      ctx.decryptedCredentialIds
    )
    const req = buildRequest(sec.value, sec.config, {
      method: p.method,
      path: p.path,
      query: p.query ?? {},
      body: p.body,
    })
    let res
    try {
      res = await secretRequest({ ...req, method: p.method })
    } catch (err) {
      if (!(err instanceof SecretHttpError)) throw err
      await recordSecretError(sec.id, err.code)
      throw new ToolUserError(`외부 API 호출 실패: ${err.code}`)
    }
    if (res.status >= 400) {
      await recordSecretError(sec.id, `HTTP ${res.status}`)
      // 본문은 싣지 않는다. 오류로 끝나야 승인 건이 FAILED가 된다.
      throw new ToolUserError(`외부 API 오류: HTTP ${res.status}`)
    }
    await recordSecretUsed(sec.id)
    return filterResponse(null, res, sec.value)
  },
}

export const secretHttpActions: ActionDefinition[] = [
  secretHttpRequest as unknown as ActionDefinition,
]
