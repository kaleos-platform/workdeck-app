/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({ prisma: { spaceMember: { findFirst: jest.fn() } } }))
jest.mock('@/lib/agent/audit', () => ({
  AUDIT_UNAVAILABLE: '감사 기록을 남길 수 없어 실행하지 않았습니다',
  startToolAudit: jest.fn(),
  finishToolAudit: jest.fn(),
  maskSecrets: (s: string) => s,
}))
import { Prisma } from '@/generated/prisma/client'
import { ToolUserError } from '../errors'
import { finishToolAudit, startToolAudit } from '@/lib/agent/audit'
import {
  buildToolContext,
  runTool,
  splitMetaArgs,
  ToolScopeError,
  TOOL_INTERNAL_ERROR,
  toolErrorMessage,
  readAuthExtra,
  systemToolContext,
} from '../run-tool'
import type { McpToolContext, ToolDefinition } from '../types'
import { ALL_SCOPES } from '@/lib/agent/identity/principal'
import { prisma } from '@/lib/prisma'
import { withRequester } from '../run-tool'

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
  it('systemToolContext는 내장 에이전트 actor와 전체 scope, 요청자는 비어 있다', () => {
    const c = systemToolContext('sp1')
    expect(c.actor).toEqual({ type: 'system', id: 'workdeck-agent' })
    expect(c.scopes).toContain('ads:write')
    expect(c).toMatchObject({ requesterUserId: null, requesterSlackUserId: null })
  })
  it('splitMetaArgs: requesterSlackUserId는 메타로 빼고 도구 인자에 넘기지 않는다', () => {
    expect(splitMetaArgs({ requesterSlackUserId: 'U123', a: 1 })).toEqual({
      meta: { requesterSlackUserId: 'U123' },
      toolArgs: { a: 1 },
    })
  })
  describe('withRequester', () => {
    const findFirst = (prisma as unknown as { spaceMember: { findFirst: jest.Mock } }).spaceMember
      .findFirst
    const integration = (): McpToolContext => ({
      ...ctx(ALL_SCOPES),
      actor: { type: 'integration', id: 'ig1' },
      requesterUserId: 'u-session',
    })
    it('Slack ID가 없으면 연동 계정 세션의 requesterUserId를 그대로 둔다', async () => {
      await expect(withRequester(integration(), undefined)).resolves.toMatchObject({
        requesterUserId: 'u-session',
        requesterSlackUserId: null,
      })
      expect(findFirst).not.toHaveBeenCalled()
    })
    it('Slack ID가 있으면 Slack 요청자가 이긴다(같은 Space 구성원)', async () => {
      findFirst.mockResolvedValue({ userId: 'u-slack' })
      await expect(withRequester(integration(), 'U123')).resolves.toMatchObject({
        requesterUserId: 'u-slack',
        requesterSlackUserId: 'U123',
      })
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { spaceId: 'sp1', slackUserId: 'U123' } })
      )
    })
    it('구성원 본인 세션은 Slack ID를 넘겨도 요청자를 채우지 않는다', async () => {
      const member = { ...ctx(ALL_SCOPES), actor: { type: 'user' as const, id: 'u1' } }
      await expect(withRequester(member, 'U123')).resolves.toMatchObject({
        requesterUserId: null,
        requesterSlackUserId: null,
      })
      expect(findFirst).not.toHaveBeenCalled()
    })
    it('확인되지 않는 Slack ID → null, 원문 ID는 남긴다', async () => {
      findFirst.mockResolvedValue(null)
      await expect(withRequester(integration(), 'U999')).resolves.toMatchObject({
        requesterUserId: null,
        requesterSlackUserId: 'U999',
      })
    })
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
        throw new ToolUserError('boom')
      }),
    }
    await expect(runTool(failing, ctx(['ads:write']), {})).rejects.toThrow('boom')
    expect(finishToolAudit).toHaveBeenLastCalledWith(
      'aud1',
      expect.objectContaining({ outcome: 'error', error: 'boom' })
    )
  })
  it.each([
    ['TypeError', new TypeError("Cannot read properties of null (reading 'id')")],
    ['일반 Error(라이브러리)', new Error('socket hang up at 10.0.0.1')],
  ])('%s → 사용자에게 일반 문구, 감사 행에는 종류·원문', async (_label, thrown) => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const failing = {
      ...writeTool,
      execute: jest.fn(async () => {
        throw thrown
      }),
    }
    const p = runTool(failing, ctx(['ads:write']), {})
    await expect(p).rejects.toThrow(TOOL_INTERNAL_ERROR)
    await expect(p.catch(toolErrorMessage)).resolves.toBe(TOOL_INTERNAL_ERROR)
    expect((finishToolAudit as jest.Mock).mock.calls[0][1].error).toBe(
      `${thrown.name}: ${thrown.message}`
    )
  })
  it('toolErrorMessage: 도메인 오류는 원문, 그 밖은 일반 문구', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(toolErrorMessage(new ToolScopeError('ads:write'))).toBe(
      '권한(scope)이 없습니다: ads:write'
    )
    expect(toolErrorMessage(new ToolUserError('쿠팡 광고 카드가 활성화되지 않았습니다'))).toBe(
      '쿠팡 광고 카드가 활성화되지 않았습니다'
    )
    expect(toolErrorMessage(new RangeError('Invalid array length'))).toBe(TOOL_INTERNAL_ERROR)
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
