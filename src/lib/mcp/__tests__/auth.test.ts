/** @jest-environment node */
const getClaims = jest.fn()
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getClaims } }) }))
jest.mock('@/lib/agent/identity/agent-token', () => ({
  AGENT_TOKEN_PREFIX: 'wdk_agt_',
  verifyAgentToken: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    spaceAgent: { findUnique: jest.fn() },
    spaceMember: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { verifyAgentToken } from '@/lib/agent/identity/agent-token'
import { verifyToken } from '../auth'

const p = prisma as unknown as {
  user: { findUnique: jest.Mock }
  spaceAgent: { findUnique: jest.Mock }
  spaceMember: { findUnique: jest.Mock; findMany: jest.Mock }
}
const URL_ = 'https://proj.supabase.co'
const req = (headers: Record<string, string> = {}) =>
  new Request('http://x/api/mcp/mcp', { headers })
const claims = (over: Record<string, unknown> = {}) => ({
  data: {
    claims: {
      sub: 'u1',
      aud: 'authenticated',
      iss: `${URL_}/auth/v1`,
      client_id: 'cid-1',
      ...over,
    },
  },
  error: null,
})

describe('verifyToken', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    delete process.env.MCP_ALLOWED_CLIENT_IDS
    p.user.findUnique.mockResolvedValue({ id: 'u1' })
    p.spaceAgent.findUnique.mockResolvedValue(null)
  })

  it('에이전트 토큰 → principal을 extra에 담는다', async () => {
    ;(verifyAgentToken as jest.Mock).mockResolvedValue({
      spaceId: 'sp1',
      actor: { type: 'agent', id: 'ag1' },
      scopes: ['ads:read'],
    })
    const info = await verifyToken(req(), 'wdk_agt_tok.secret')
    expect(info?.extra).toEqual({
      spaceId: 'sp1',
      actor: { type: 'agent', id: 'ag1' },
      scopes: ['ads:read'],
    })
    expect(getClaims).not.toHaveBeenCalled()
  })

  it('폐기된 에이전트 토큰 → undefined(401)', async () => {
    ;(verifyAgentToken as jest.Mock).mockResolvedValue(null)
    await expect(verifyToken(req(), 'wdk_agt_tok.secret')).resolves.toBeUndefined()
  })

  it('verifyAgentToken이 던지면(모르는 저장 scope 등) undefined(401), 로그에 토큰이 없다', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(verifyAgentToken as jest.Mock).mockRejectedValue(new Error('알 수 없는 scope: x'))
    await expect(verifyToken(req(), 'wdk_agt_tok.secretSECRET')).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secretSECRET')
    spy.mockRestore()
  })

  it.each([
    ['client_id 없는 세션 JWT', { client_id: undefined }],
    ['audience가 다른 JWT', { aud: 'other' }],
    ['issuer가 다른 JWT', { iss: 'https://evil.supabase.co/auth/v1' }],
  ])('%s → undefined(401)', async (_l, over) => {
    getClaims.mockResolvedValue(claims(over))
    await expect(verifyToken(req(), 'jwt')).resolves.toBeUndefined()
  })

  it('Space 하나인 사용자 → user actor, 전체 scope', async () => {
    getClaims.mockResolvedValue(claims())
    p.spaceMember.findMany.mockResolvedValue([{ spaceId: 'sp1' }])
    const info = await verifyToken(req(), 'jwt')
    expect(info?.extra).toMatchObject({ spaceId: 'sp1', actor: { type: 'user', id: 'u1' } })
    expect((info?.extra as { scopes: string[] }).scopes).toContain('ads:write')
  })

  it('multi-space user without binding gets authError (최고참 멤버십으로 떨어지지 않음)', async () => {
    getClaims.mockResolvedValue(claims())
    p.spaceMember.findMany.mockResolvedValue([{ spaceId: 'sp1' }, { spaceId: 'sp2' }])
    const info = await verifyToken(req(), 'jwt')
    expect(info?.extra).toEqual({ authError: expect.stringContaining('client_id=cid-1') })
  })

  it('헤더로 고른 Space가 구성원 Space면 그 Space', async () => {
    getClaims.mockResolvedValue(claims())
    p.spaceMember.findMany.mockResolvedValue([{ spaceId: 'sp1' }, { spaceId: 'sp2' }])
    const info = await verifyToken(req({ 'x-workdeck-space-id': 'sp2' }), 'jwt')
    expect(info?.extra).toMatchObject({ spaceId: 'sp2' })
  })

  it('헤더로 고른 Space가 구성원 Space가 아니면 authError', async () => {
    getClaims.mockResolvedValue(claims())
    p.spaceMember.findMany.mockResolvedValue([{ spaceId: 'sp1' }])
    const info = await verifyToken(req({ 'x-workdeck-space-id': 'sp9' }), 'jwt')
    expect(info?.extra).toHaveProperty('authError')
  })

  it('연동 계정에 묶인 client_id → integration actor, 그 Space 고정', async () => {
    getClaims.mockResolvedValue(claims())
    p.spaceAgent.findUnique.mockResolvedValue({
      id: 'int1',
      spaceId: 'sp2',
      kind: 'integration',
      scopes: ['meta:read'],
      status: 'ACTIVE',
    })
    p.spaceMember.findUnique.mockResolvedValue({ role: 'ADMIN' })
    const info = await verifyToken(req(), 'jwt')
    expect(info?.extra).toEqual({
      spaceId: 'sp2',
      actor: { type: 'integration', id: 'int1' },
      scopes: ['meta:read'],
    })
  })

  it('연동 계정 Space의 구성원이 아니면 authError (바인딩만으로 Space를 주지 않음)', async () => {
    getClaims.mockResolvedValue(claims())
    p.spaceAgent.findUnique.mockResolvedValue({
      id: 'int1',
      spaceId: 'sp2',
      kind: 'integration',
      scopes: [],
      status: 'ACTIVE',
    })
    p.spaceMember.findUnique.mockResolvedValue(null)
    p.spaceMember.findMany.mockResolvedValue([{ spaceId: 'sp1' }])
    const info = await verifyToken(req({ 'x-workdeck-space-id': 'sp1' }), 'jwt')
    expect(info?.extra).toHaveProperty('authError')
    expect(p.spaceMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId_userId: { spaceId: 'sp2', userId: 'u1' } } })
    )
    // 바인딩된 client_id는 헤더·멤버십 경로로 넘어가지 않는다
    expect(p.spaceMember.findMany).not.toHaveBeenCalled()
  })

  it('허용 목록이 있으면 목록 밖 미바인딩 client_id → undefined', async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = 'cid-ok'
    getClaims.mockResolvedValue(claims())
    await expect(verifyToken(req(), 'jwt')).resolves.toBeUndefined()
  })
})
