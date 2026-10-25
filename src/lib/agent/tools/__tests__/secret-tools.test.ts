/** @jest-environment node */
jest.mock('@/lib/agent/audit', () => ({
  AUDIT_UNAVAILABLE: 'x',
  startToolAudit: jest.fn(),
  finishToolAudit: jest.fn(),
  maskSecrets: (s: string) => s,
}))
jest.mock('@/lib/agent/rate', () => ({
  ...jest.requireActual('@/lib/agent/rate'),
  assertUnderRate: jest.fn(),
}))
jest.mock('@/lib/agent/secrets/store')
jest.mock('@/lib/agent/secrets/http-client', () => ({
  ...jest.requireActual('@/lib/agent/secrets/http-client'),
  secretRequest: jest.fn(),
}))
jest.mock('@/lib/agent/actions/create', () => ({ createPendingAction: jest.fn() }))

import { assertUnderRate, RateLimitedError } from '@/lib/agent/rate'
import { createPendingAction } from '@/lib/agent/actions/create'
import { finishToolAudit, startToolAudit } from '@/lib/agent/audit'
import { SecretHttpError, secretRequest } from '@/lib/agent/secrets/http-client'
import * as store from '@/lib/agent/secrets/store'
import { runTool, ToolScopeError } from '../run-tool'
import { secretTools } from '../secret-tools'
import type { McpToolContext } from '../types'

const KEY = 'SK_TEST_0123456789abcdef'
const read = secretTools.find((t) => t.name === 'secret_http_read')!
const propose = secretTools.find((t) => t.name === 'secret_http_propose')!
const ctx = (scopes: McpToolContext['scopes']): McpToolContext => ({
  spaceId: 'sp1',
  actor: { type: 'agent', id: 'ag1' },
  scopes,
  workId: 'wk_t',
  requesterUserId: null,
  requesterSlackUserId: null,
  decryptedCredentialIds: [],
})
const config = {
  baseUrl: 'https://api.example.com',
  auth: { in: 'header', name: 'X-Key', template: '{value}' },
  readOps: [
    {
      id: 'list-items',
      method: 'GET',
      pathPattern: '/items',
      query: {},
      responseFields: ['items[].name'],
      responseHeaders: [],
    },
  ],
}
const args = { secret: 'my-key', op: 'list-items', path: '/items' }

beforeEach(() => {
  jest.clearAllMocks()
  ;(startToolAudit as jest.Mock).mockResolvedValue('aud1')
  ;(finishToolAudit as jest.Mock).mockResolvedValue(undefined)
  ;(store.loadSecretForUse as jest.Mock).mockResolvedValue({
    id: 's1',
    revision: 3,
    value: KEY,
    config,
  })
})

describe('secret_http_read', () => {
  it('secret:read가 없으면 ToolScopeError', async () => {
    await expect(runTool(read, ctx(['secret:write']), args)).rejects.toThrow(
      new ToolScopeError('secret:read')
    )
    expect(store.loadSecretForUse).not.toHaveBeenCalled()
  })

  it('등록 op 밖 GET은 거부하고 업스트림을 부르지 않는다', async () => {
    await expect(runTool(read, ctx(['secret:read']), { ...args, path: '/admin' })).rejects.toThrow(
      '등록된 조회 operation이 아닙니다'
    )
    await expect(runTool(read, ctx(['secret:read']), { ...args, op: 'nope' })).rejects.toThrow(
      '등록된 조회 operation이 아닙니다'
    )
    expect(secretRequest).not.toHaveBeenCalled()
  })

  it('성공하면 허용 필드만 돌려주고 lastUsedAt을 갱신한다', async () => {
    ;(secretRequest as jest.Mock).mockResolvedValue({
      status: 200,
      headers: {},
      json: { items: [{ name: 'a', secret: 'x' }] },
    })
    const out = await runTool(read, ctx(['secret:read']), args)
    expect(out).toEqual({ status: 200, body: { items: [{ name: 'a' }] }, headers: {} })
    expect(store.recordSecretUsed).toHaveBeenCalledWith('s1')
  })

  it('JSON이 아니거나 처리할 수 없는 응답(json: null)은 본문 없이 status만', async () => {
    ;(secretRequest as jest.Mock).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      json: null,
    })
    await expect(runTool(read, ctx(['secret:read']), args)).resolves.toEqual({ status: 200 })
  })

  it('업스트림 500 본문의 키는 결과·오류·감사에 나타나지 않는다', async () => {
    ;(secretRequest as jest.Mock).mockResolvedValue({
      status: 500,
      headers: {},
      json: { error: `bad key ${KEY}` },
    })
    const err = (await runTool(read, ctx(['secret:read']), args).catch((e) => e)) as Error
    expect(err.message).toBe('외부 API 오류: HTTP 500 (list-items)')
    expect(JSON.stringify([(finishToolAudit as jest.Mock).mock.calls, err.message])).not.toContain(
      KEY
    )
    expect(store.recordSecretError).toHaveBeenCalledWith('s1', 'HTTP 500')
  })

  it('SecretHttpError는 코드만 담은 오류로 바뀐다', async () => {
    ;(secretRequest as jest.Mock).mockRejectedValue(new SecretHttpError('REDIRECT'))
    await expect(runTool(read, ctx(['secret:read']), args)).rejects.toThrow(
      '외부 API 호출 실패: REDIRECT (list-items)'
    )
    expect(store.recordSecretError).toHaveBeenCalledWith('s1', 'REDIRECT')
  })
})

describe('호출 빈도 상한', () => {
  const tooMany = '호출이 너무 많습니다. 잠시 후 다시 시도하세요'
  it('secret_http_read가 상한 초과 시 ToolUserError(잠시 후 다시)', async () => {
    ;(assertUnderRate as jest.Mock).mockRejectedValueOnce(new RateLimitedError())
    await expect(runTool(read, ctx(['secret:read']), args)).rejects.toThrow(tooMany)
    expect(store.loadSecretForUse).not.toHaveBeenCalled()
  })
  it('secret_http_propose가 상한 초과 시 제안을 만들지 않는다', async () => {
    ;(assertUnderRate as jest.Mock).mockRejectedValueOnce(new RateLimitedError())
    await expect(
      runTool(propose, ctx(['secret:write']), {
        secret: 'k',
        method: 'GET',
        path: '/x',
        summary: 's',
      })
    ).rejects.toThrow(tooMany)
    expect(createPendingAction).not.toHaveBeenCalled()
  })
  it('분당 N회까지 허용: 이번 호출의 감사 행이 이미 세어지므로 limit은 N+1', async () => {
    ;(secretRequest as jest.Mock).mockResolvedValue({ status: 200, headers: {}, json: null })
    await runTool(read, ctx(['secret:read']), args)
    expect(assertUnderRate).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'sp1',
        actorId: 'ag1',
        tools: ['secret_http_read'],
        limit: 61,
        windowMs: 60000,
      })
    )
    ;(store.assertSecretUsable as jest.Mock).mockResolvedValue({
      id: 's1',
      revision: 1,
      baseUrl: 'https://a.com',
    })
    ;(createPendingAction as jest.Mock).mockResolvedValue({})
    await runTool(propose, ctx(['secret:write']), {
      secret: 'k',
      method: 'GET',
      path: '/x',
      summary: 's',
    })
    expect(assertUnderRate).toHaveBeenLastCalledWith(
      expect.objectContaining({ tools: ['secret_http_propose'], limit: 21 })
    )
  })
  it('actorTokenId가 있으면 제안에 싣는다', async () => {
    ;(store.assertSecretUsable as jest.Mock).mockResolvedValue({
      id: 's1',
      revision: 1,
      baseUrl: 'https://a.com',
    })
    ;(createPendingAction as jest.Mock).mockResolvedValue({})
    await runTool(
      propose,
      { ...ctx(['secret:write']), actorTokenId: 'tk1' },
      { secret: 'k', method: 'GET', path: '/x', summary: 's' }
    )
    expect((createPendingAction as jest.Mock).mock.calls[0][0].actorTokenId).toBe('tk1')
  })
})

describe('secret_http_propose', () => {
  it('secret:write가 없으면 ToolScopeError', async () => {
    await expect(
      runTool(propose, ctx(['secret:read']), {
        secret: 'my-key',
        method: 'POST',
        path: '/x',
        summary: 's',
      })
    ).rejects.toThrow(new ToolScopeError('secret:write'))
  })

  it('createPendingAction 인자에 값이 없고 revision이 들어간다', async () => {
    ;(store.assertSecretUsable as jest.Mock).mockResolvedValue({
      id: 's1',
      revision: 3,
      baseUrl: 'https://api.example.com/',
    })
    ;(createPendingAction as jest.Mock).mockResolvedValue({ status: 'pending_approval' })
    await runTool(propose, ctx(['secret:write']), {
      secret: 'my-key',
      method: 'POST',
      path: '/x',
      body: { a: 1 },
      summary: '요약',
    })
    const arg = (createPendingAction as jest.Mock).mock.calls[0][0]
    expect(arg.actionType).toBe('secret.http.request')
    expect(arg.params).toMatchObject({
      secretId: 's1',
      secretName: 'my-key',
      target: 'my-key',
      url: 'https://api.example.com/x',
      revision: 3,
    })
    expect(JSON.stringify(arg)).not.toContain(KEY)
    expect(store.loadSecretForUse).not.toHaveBeenCalled()
  })
})
