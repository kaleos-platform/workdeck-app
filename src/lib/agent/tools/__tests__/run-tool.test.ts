/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/agent/audit', () => ({
  AUDIT_UNAVAILABLE: '감사 기록을 남길 수 없어 실행하지 않았습니다',
  startToolAudit: jest.fn(),
  finishToolAudit: jest.fn(),
}))
import { Prisma } from '@/generated/prisma/client'
import { finishToolAudit, startToolAudit } from '@/lib/agent/audit'
import {
  buildToolContext,
  runTool,
  splitMetaArgs,
  ToolScopeError,
  TOOL_INTERNAL_ERROR,
  readAuthExtra,
  systemToolContext,
} from '../run-tool'
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

beforeEach(() => {
  jest.clearAllMocks()
  ;(startToolAudit as jest.Mock).mockResolvedValue('aud1')
  ;(finishToolAudit as jest.Mock).mockResolvedValue(undefined)
})

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
  it('scope 거부도 감사 로그(outcome=denied)에 남긴다', async () => {
    await expect(runTool(writeTool, ctx(['ads:read']), { from: 'a' })).rejects.toThrow()
    expect(startToolAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'ads_trigger_analysis',
        outcome: 'denied',
        workId: 'wk_test',
      })
    )
  })
  it('실행 전에 started 행을 만들고, 성공·실패를 같은 행에 갱신한다', async () => {
    await runTool(writeTool, ctx(['ads:write']), {})
    expect(finishToolAudit).toHaveBeenLastCalledWith(
      'aud1',
      expect.objectContaining({ outcome: 'ok' })
    )
    const failing = {
      ...writeTool,
      execute: jest.fn(async () => {
        throw new Error('boom')
      }),
    }
    await expect(runTool(failing, ctx(['ads:write']), {})).rejects.toThrow('boom')
    expect(finishToolAudit).toHaveBeenLastCalledWith(
      'aud1',
      expect.objectContaining({ outcome: 'error', error: 'boom' })
    )
  })
  it('begin failure → execute not called', async () => {
    const exec = jest.fn(async () => ({ ok: true }))
    ;(startToolAudit as jest.Mock).mockRejectedValue(
      new Error('감사 기록을 남길 수 없어 실행하지 않았습니다')
    )
    await expect(runTool({ ...writeTool, execute: exec }, ctx(['ads:write']), {})).rejects.toThrow(
      '감사 기록을 남길 수 없어'
    )
    expect(exec).not.toHaveBeenCalled()
  })
  it('finish failure → execute는 정확히 1회, 결과는 그대로 반환(재실행 없음)', async () => {
    const exec = jest.fn(async () => ({ ok: true }))
    // finishToolAudit은 계약상 throw하지 않지만, 던지더라도 runTool이 오류로 바꾸면 호출자가 재시도해 쓰기가 두 번 실행된다.
    ;(finishToolAudit as jest.Mock).mockRejectedValue(new Error('db'))
    await expect(runTool({ ...writeTool, execute: exec }, ctx(['ads:write']), {})).resolves.toEqual(
      { ok: true }
    )
    expect(exec).toHaveBeenCalledTimes(1)
    expect(finishToolAudit).toHaveBeenCalledTimes(1)
  })
  it('DB 오류는 사용자에게 일반 문구, 감사 행에는 종류·코드만(원문 미노출)', async () => {
    const dbErr = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on secret_col',
      {
        code: 'P2002',
        clientVersion: 'x',
      }
    )
    const failing = {
      ...writeTool,
      execute: jest.fn(async () => {
        throw dbErr
      }),
    }
    await expect(runTool(failing, ctx(['ads:write']), {})).rejects.toThrow(TOOL_INTERNAL_ERROR)
    const recorded = (finishToolAudit as jest.Mock).mock.calls[0][1]
    expect(recorded).toMatchObject({
      outcome: 'error',
      error: 'PrismaClientKnownRequestError P2002',
    })
    expect(recorded.error).not.toContain('secret_col')
  })
  it('메타 인자는 도구 인자에서 빠진다', () => {
    expect(splitMetaArgs({ workId: 'w1', campaignId: 'c' })).toEqual({
      meta: { workId: 'w1' },
      toolArgs: { campaignId: 'c' },
    })
  })
  it('연동 계정 principal의 requesterUserId가 컨텍스트로 전달된다', () => {
    const r = readAuthExtra({
      spaceId: 'sp1',
      actor: { type: 'integration', id: 'int1' },
      scopes: ['meta:read'],
      requesterUserId: 'u1',
    })
    if (!r.ok) throw new Error('principal expected')
    expect(buildToolContext(r.principal, { workId: 'w1' })).toMatchObject({
      requesterUserId: 'u1',
      workId: 'w1',
    })
  })
})
