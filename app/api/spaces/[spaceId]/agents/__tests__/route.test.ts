/** @jest-environment node */
import { NextRequest } from 'next/server'

jest.mock('@/lib/agent/identity/space-admin', () => ({ requireSpaceAdmin: jest.fn() }))
jest.mock('@/lib/agent/identity/agent-token', () => ({
  issueAgentToken: jest.fn(),
  revokeAgentToken: jest.fn(),
}))
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn() }))
jest.mock('@/lib/agent/identity/oauth-client-consent', () => ({
  OAUTH_CONSENT_REQUIRED: '동의 필요',
  hasActiveOAuthConsent: jest.fn(),
}))
jest.mock('@/lib/admin/auth', () => ({ writeAuditLog: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceAgent: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  },
}))

import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { issueAgentToken, revokeAgentToken } from '@/lib/agent/identity/agent-token'
import { prisma } from '@/lib/prisma'
import { requireAal2 } from '@/lib/auth/mfa'
import { hasActiveOAuthConsent } from '@/lib/agent/identity/oauth-client-consent'
import { writeAuditLog } from '@/lib/admin/auth'
import { GET as listAgents, POST as createAgent } from '../route'
import { PATCH as patchAgent } from '../[agentId]/route'
import { POST as issueToken } from '../[agentId]/tokens/route'
import { DELETE as revokeToken } from '../[agentId]/tokens/[tokenId]/route'

const admin = requireSpaceAdmin as jest.Mock
const aal2 = requireAal2 as jest.Mock
const audit = writeAuditLog as jest.Mock
const mfaRes = () => new Response(JSON.stringify({ code: 'MFA_REQUIRED' }), { status: 403 })
const p = prisma as unknown as { spaceAgent: Record<string, jest.Mock> }
const params = <T>(v: T) => ({ params: Promise.resolve(v) })
const json = (body: unknown, method = 'POST') =>
  new NextRequest('http://x/api', { method, body: JSON.stringify(body) })

describe('/api/spaces/[spaceId]/agents', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    aal2.mockResolvedValue(null)
  })

  it('ADMIN이 아니면 403을 그대로 돌려준다', async () => {
    admin.mockResolvedValue({ error: new Response('{}', { status: 403 }) })
    const res = await createAgent(
      json({ name: 'x', kind: 'agent', scopes: [] }),
      params({ spaceId: 'sp1' })
    )
    expect(res.status).toBe(403)
    expect(admin).toHaveBeenCalledWith('sp1')
    expect(p.spaceAgent.create).not.toHaveBeenCalled()
  })

  it('모르는 scope는 400', async () => {
    admin.mockResolvedValue({ userId: 'u1' })
    const res = await createAgent(
      json({ name: '에밀리', kind: 'agent', scopes: ['root:all'] }),
      params({ spaceId: 'sp1' })
    )
    expect(res.status).toBe(400)
  })

  it('목록은 경로의 Space로만 조회한다', async () => {
    admin.mockResolvedValue({ userId: 'u1' })
    p.spaceAgent.findMany.mockResolvedValue([])
    const res = await listAgents(new NextRequest('http://x/api'), params({ spaceId: 'sp1' }))
    expect(res.status).toBe(200)
    expect(admin).toHaveBeenCalledWith('sp1')
    expect(p.spaceAgent.findMany.mock.calls[0][0].where).toEqual({ spaceId: 'sp1' })
    expect(JSON.stringify(p.spaceAgent.findMany.mock.calls[0][0].select)).not.toContain('tokenHash')
  })

  it('다른 Space의 에이전트로 토큰 발급 시 404', async () => {
    admin.mockResolvedValue({ userId: 'u1' })
    p.spaceAgent.findFirst.mockResolvedValue(null)
    const res = await issueToken(json({}), params({ spaceId: 'sp1', agentId: 'ag-other' }))
    expect(res.status).toBe(404)
    expect(p.spaceAgent.findFirst.mock.calls[0][0].where).toEqual({
      id: 'ag-other',
      spaceId: 'sp1',
    })
    expect(issueAgentToken).not.toHaveBeenCalled()
  })

  it('다른 Space의 에이전트 토큰 폐기 시 404', async () => {
    admin.mockResolvedValue({ userId: 'u1' })
    p.spaceAgent.findFirst.mockResolvedValue(null)
    const res = await revokeToken(
      new NextRequest('http://x/api', { method: 'DELETE' }),
      params({ spaceId: 'sp1', agentId: 'ag-other', tokenId: 't1' })
    )
    expect(res.status).toBe(404)
    expect(p.spaceAgent.findFirst.mock.calls[0][0].where).toEqual({
      id: 'ag-other',
      spaceId: 'sp1',
    })
    expect(revokeAgentToken).not.toHaveBeenCalled()
  })

  it('다른 Space의 에이전트 수정 시 404', async () => {
    admin.mockResolvedValue({ userId: 'u1' })
    p.spaceAgent.findFirst.mockResolvedValue(null)
    const res = await patchAgent(
      json({ status: 'DISABLED' }, 'PATCH'),
      params({ spaceId: 'sp1', agentId: 'ag-other' })
    )
    expect(res.status).toBe(404)
    expect(p.spaceAgent.update).not.toHaveBeenCalled()
  })

  it('폐기는 경로 에이전트 범위로 위임한다(다른 에이전트의 토큰이면 404)', async () => {
    admin.mockResolvedValue({ userId: 'u1' })
    p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1', status: 'ACTIVE' })
    ;(revokeAgentToken as jest.Mock).mockResolvedValue(false)
    const res = await revokeToken(
      new NextRequest('http://x/api', { method: 'DELETE' }),
      params({ spaceId: 'sp1', agentId: 'ag1', tokenId: 't-other' })
    )
    expect(res.status).toBe(404)
    expect(revokeAgentToken).toHaveBeenCalledWith('ag1', 't-other')
  })

  it('비활성 에이전트에는 토큰을 발급하지 않는다(409)', async () => {
    admin.mockResolvedValue({ userId: 'u1' })
    p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1', status: 'DISABLED' })
    const res = await issueToken(json({}), params({ spaceId: 'sp1', agentId: 'ag1' }))
    expect(res.status).toBe(409)
    expect(issueAgentToken).not.toHaveBeenCalled()
  })

  it('발급 감사 기록이 실패하면 방금 발급한 토큰을 폐기한다', async () => {
    admin.mockResolvedValue({ userId: 'u1' })
    p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1', status: 'ACTIVE' })
    ;(issueAgentToken as jest.Mock).mockResolvedValue({
      tokenId: 't9',
      token: 'wdk_agt_t9.s',
      expiresAt: new Date('2027-01-07T00:00:00Z'),
    })
    audit.mockRejectedValueOnce(new Error('db down'))
    await expect(
      issueToken(json({ expiresInDays: 30 }), params({ spaceId: 'sp1', agentId: 'ag1' }))
    ).rejects.toThrow('db down')
    expect(revokeAgentToken).toHaveBeenCalledWith('ag1', 't9')
  })

  it('토큰은 한 번만 응답하고 no-store', async () => {
    admin.mockResolvedValue({ userId: 'u1' })
    p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1', status: 'ACTIVE' })
    ;(issueAgentToken as jest.Mock).mockResolvedValue({
      tokenId: 't1',
      token: 'wdk_agt_t1.s',
      expiresAt: new Date('2027-01-07T00:00:00Z'),
    })
    const res = await issueToken(
      json({ expiresInDays: 90 }),
      params({ spaceId: 'sp1', agentId: 'ag1' })
    )
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.token).toBe('wdk_agt_t1.s')
    expect(body.expiresAt).toBe('2027-01-07T00:00:00.000Z')
    expect(issueAgentToken).toHaveBeenCalledWith('ag1', { expiresInDays: 90 })
  })

  it.each([0, 366, 1.5, 'x'])('expiresInDays=%p 이면 400', async (days) => {
    admin.mockResolvedValue({ userId: 'u1' })
    p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1', status: 'ACTIVE' })
    const res = await issueToken(
      json({ expiresInDays: days }),
      params({ spaceId: 'sp1', agentId: 'ag1' })
    )
    expect(res.status).toBe(400)
    expect(issueAgentToken).not.toHaveBeenCalled()
  })

  describe('MFA·감사 로그', () => {
    it('에이전트 생성은 aal2가 없으면 MFA 응답을 그대로 주고 쓰지 않는다', async () => {
      admin.mockResolvedValue({ userId: 'u1' })
      aal2.mockResolvedValue(mfaRes())
      const res = await createAgent(
        json({ name: '테스트 에이전트', kind: 'agent', scopes: ['ads:read'] }),
        params({ spaceId: 'sp1' })
      )
      expect(res.status).toBe(403)
      expect((await res.json()).code).toBe('MFA_REQUIRED')
      expect(p.spaceAgent.create).not.toHaveBeenCalled()
      expect(audit).not.toHaveBeenCalled()
    })

    it('에이전트 생성 시 감사 로그를 남긴다', async () => {
      admin.mockResolvedValue({ userId: 'u1' })
      p.spaceAgent.create.mockResolvedValue({
        id: 'ag1',
        name: '테스트 에이전트',
        kind: 'agent',
        scopes: ['ads:read'],
      })
      const res = await createAgent(
        json({ name: '테스트 에이전트', kind: 'agent', scopes: ['ads:read'] }),
        params({ spaceId: 'sp1' })
      )
      expect(res.status).toBe(201)
      expect(audit).toHaveBeenCalledWith('u1', 'space.agent.create', 'space_agent', 'ag1', {
        spaceId: 'sp1',
        name: '테스트 에이전트',
        kind: 'agent',
        scopes: ['ads:read'],
      })
    })

    it.each([
      { scopes: ['ads:read'] },
      { status: 'ACTIVE' },
      { oauthClientId: 'cl_1' },
      { status: 'DISABLED', scopes: ['ads:read'] },
      { status: 'DISABLED', oauthClientId: null },
      { scopes: [] },
    ])('PATCH %p 는 aal2가 필요하다', async (body) => {
      admin.mockResolvedValue({ userId: 'u1' })
      aal2.mockResolvedValue(mfaRes())
      p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1', kind: 'integration' })
      const res = await patchAgent(json(body, 'PATCH'), params({ spaceId: 'sp1', agentId: 'ag1' }))
      expect(res.status).toBe(403)
      expect(p.spaceAgent.update).not.toHaveBeenCalled()
      expect(audit).not.toHaveBeenCalled()
    })

    it('DISABLED만 바꾸는 PATCH는 aal2 없이 되고 감사 로그를 남긴다', async () => {
      admin.mockResolvedValue({ userId: 'u1' })
      aal2.mockResolvedValue(mfaRes())
      p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1', kind: 'agent' })
      p.spaceAgent.update.mockResolvedValue({ id: 'ag1', scopes: ['ads:read'], status: 'DISABLED' })
      const res = await patchAgent(
        json({ status: 'DISABLED' }, 'PATCH'),
        params({ spaceId: 'sp1', agentId: 'ag1' })
      )
      expect(res.status).toBe(200)
      expect(aal2).not.toHaveBeenCalled()
      expect(audit).toHaveBeenCalledWith('u1', 'space.agent.update', 'space_agent', 'ag1', {
        spaceId: 'sp1',
        changed: ['status'],
        scopes: ['ads:read'],
        status: 'DISABLED',
        oauthClientId: undefined,
      })
    })

    it('빈 PATCH는 400, 쓰기·감사 로그 없음', async () => {
      admin.mockResolvedValue({ userId: 'u1' })
      p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1', kind: 'agent' })
      const res = await patchAgent(json({}, 'PATCH'), params({ spaceId: 'sp1', agentId: 'ag1' }))
      expect(res.status).toBe(400)
      expect(p.spaceAgent.update).not.toHaveBeenCalled()
      expect(audit).not.toHaveBeenCalled()
    })

    it('토큰 발급은 aal2가 필요하다', async () => {
      admin.mockResolvedValue({ userId: 'u1' })
      aal2.mockResolvedValue(mfaRes())
      const res = await issueToken(json({}), params({ spaceId: 'sp1', agentId: 'ag1' }))
      expect(res.status).toBe(403)
      expect(issueAgentToken).not.toHaveBeenCalled()
      expect(audit).not.toHaveBeenCalled()
    })

    it('토큰 발급 감사 로그에 평문 토큰이 없다', async () => {
      admin.mockResolvedValue({ userId: 'u1' })
      p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1', status: 'ACTIVE' })
      ;(issueAgentToken as jest.Mock).mockResolvedValue({
        tokenId: 't1',
        token: 'wdk_agt_t1.SECRETVALUE',
        expiresAt: new Date('2027-01-07T00:00:00Z'),
      })
      const res = await issueToken(
        json({ expiresInDays: 30 }),
        params({ spaceId: 'sp1', agentId: 'ag1' })
      )
      expect(res.status).toBe(201)
      expect(audit).toHaveBeenCalledWith('u1', 'space.agent.token.issue', 'agent_token', 't1', {
        spaceId: 'sp1',
        agentId: 'ag1',
        expiresAt: '2027-01-07T00:00:00.000Z',
      })
      expect(JSON.stringify(audit.mock.calls)).not.toContain('SECRETVALUE')
    })

    it('토큰 폐기는 aal2 없이 되고 감사 로그를 남긴다', async () => {
      admin.mockResolvedValue({ userId: 'u1' })
      aal2.mockResolvedValue(mfaRes())
      p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1' })
      ;(revokeAgentToken as jest.Mock).mockResolvedValue(true)
      const res = await revokeToken(
        new NextRequest('http://x/api', { method: 'DELETE' }),
        params({ spaceId: 'sp1', agentId: 'ag1', tokenId: 't1' })
      )
      expect(res.status).toBe(200)
      expect(aal2).not.toHaveBeenCalled()
      expect(audit).toHaveBeenCalledWith('u1', 'space.agent.token.revoke', 'agent_token', 't1', {
        spaceId: 'sp1',
        agentId: 'ag1',
      })
    })
  })

  describe('OAuth 클라이언트 연결 — 본인 동의 필요', () => {
    const consent = hasActiveOAuthConsent as jest.Mock
    beforeEach(() => {
      admin.mockResolvedValue({ userId: 'u1' })
      aal2.mockResolvedValue(null)
    })

    it('생성 시 본인 동의가 없으면 403, 만들지 않는다', async () => {
      consent.mockResolvedValue(false)
      const res = await createAgent(
        json({ name: '연동', kind: 'integration', scopes: ['ads:read'], oauthClientId: 'cl-x' }),
        params({ spaceId: 'sp1' })
      )
      expect(res.status).toBe(403)
      expect(consent).toHaveBeenCalledWith('u1', 'cl-x')
      expect(p.spaceAgent.create).not.toHaveBeenCalled()
    })

    it('생성 시 본인 동의가 있으면 만든다', async () => {
      consent.mockResolvedValue(true)
      p.spaceAgent.create.mockResolvedValue({
        id: 'ag9',
        name: '연동',
        kind: 'integration',
        scopes: ['ads:read'],
      })
      const res = await createAgent(
        json({ name: '연동', kind: 'integration', scopes: ['ads:read'], oauthClientId: 'cl-mine' }),
        params({ spaceId: 'sp1' })
      )
      expect(res.status).toBe(201)
    })

    it('PATCH 연결은 본인 동의가 없으면 403, 갱신 없음', async () => {
      consent.mockResolvedValue(false)
      p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1', kind: 'integration' })
      const res = await patchAgent(
        json({ oauthClientId: 'cl-x' }, 'PATCH'),
        params({ spaceId: 'sp1', agentId: 'ag1' })
      )
      expect(res.status).toBe(403)
      expect(p.spaceAgent.update).not.toHaveBeenCalled()
    })

    it('PATCH 해제(null)는 동의 확인 없이 된다', async () => {
      p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1', kind: 'integration' })
      p.spaceAgent.update.mockResolvedValue({
        id: 'ag1',
        scopes: [],
        status: 'ACTIVE',
        oauthClientId: null,
      })
      const res = await patchAgent(
        json({ oauthClientId: null }, 'PATCH'),
        params({ spaceId: 'sp1', agentId: 'ag1' })
      )
      expect(res.status).toBe(200)
      expect(consent).not.toHaveBeenCalled()
    })
  })
})
