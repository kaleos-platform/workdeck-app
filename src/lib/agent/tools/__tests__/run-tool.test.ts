/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
import { runTool, ToolScopeError, readAuthExtra, systemToolContext } from '../run-tool'
import type { McpToolContext, ToolDefinition } from '../types'
import { ALL_SCOPES } from '@/lib/agent/identity/principal'

const ctx = (scopes: McpToolContext['scopes']): McpToolContext => ({
  spaceId: 'sp1',
  actor: { type: 'agent', id: 'ag1' },
  scopes,
  workId: 'wk_test',
  requesterUserId: null,
  requesterSlackUserId: null,
  decryptedCredentialIds: [],
})
const writeTool: ToolDefinition = {
  name: 'ads_trigger_analysis',
  description: '',
  inputSchema: {},
  mode: 'write',
  scope: 'ads:write',
  execute: jest.fn(async () => ({ status: 'pending_approval' })),
}

describe('runTool', () => {
  it('read-only 에이전트가 write 도구 호출 → ToolScopeError, execute 미호출', async () => {
    await expect(runTool(writeTool, ctx(['ads:read']), {})).rejects.toThrow(
      new ToolScopeError('ads:write')
    )
    expect(writeTool.execute).not.toHaveBeenCalled()
  })
  it('scope가 있으면 실행', async () => {
    await expect(runTool(writeTool, ctx(['ads:write']), {})).resolves.toEqual({
      status: 'pending_approval',
    })
  })
  it('readAuthExtra: authError는 그대로 이유를 돌려준다', () => {
    expect(readAuthExtra({ authError: '여러 Space' })).toEqual({ ok: false, reason: '여러 Space' })
    expect(readAuthExtra({ userId: 'u1' })).toEqual({ ok: false, reason: '인증 정보가 없습니다' })
  })
  it('readAuthExtra: 정상 principal과 잘못된 scope', () => {
    const actor = { type: 'agent', id: 'ag1' }
    expect(readAuthExtra({ spaceId: 'sp1', actor, scopes: ['ads:read'] })).toEqual({
      ok: true,
      principal: { spaceId: 'sp1', actor, scopes: ['ads:read'] },
    })
    expect(readAuthExtra({ spaceId: 'sp1', actor, scopes: ['root'] })).toEqual({
      ok: false,
      reason: '인증 정보가 없습니다',
    })
  })
  it('readAuthExtra: verifyToken 구성원 토큰 모양(전체 scope)을 받아들인다', () => {
    const extra = { spaceId: 'sp1', actor: { type: 'user', id: 'u1' }, scopes: [...ALL_SCOPES] }
    expect(readAuthExtra(extra)).toEqual({ ok: true, principal: extra })
  })
  it('systemToolContext는 내장 에이전트 actor와 전체 scope', () => {
    const c = systemToolContext('sp1', { requesterSlackUserId: 'U1' })
    expect(c.actor).toEqual({ type: 'system', id: 'workdeck-agent' })
    expect(c.scopes).toContain('ads:write')
    expect(c.requesterSlackUserId).toBe('U1')
  })
})
