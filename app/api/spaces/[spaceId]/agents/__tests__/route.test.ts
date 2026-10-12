/** @jest-environment node */
import { NextRequest } from 'next/server'

jest.mock('@/lib/agent/identity/space-admin', () => ({ requireSpaceAdmin: jest.fn() }))
jest.mock('@/lib/agent/identity/agent-token', () => ({
  issueAgentToken: jest.fn(),
  revokeAgentToken: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceAgent: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  },
}))

import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { issueAgentToken, revokeAgentToken } from '@/lib/agent/identity/agent-token'
import { prisma } from '@/lib/prisma'
import { GET as listAgents, POST as createAgent } from '../route'
import { PATCH as patchAgent } from '../[agentId]/route'
import { POST as issueToken } from '../[agentId]/tokens/route'
import { DELETE as revokeToken } from '../[agentId]/tokens/[tokenId]/route'

const admin = requireSpaceAdmin as jest.Mock
const p = prisma as unknown as { spaceAgent: Record<string, jest.Mock> }
const params = <T>(v: T) => ({ params: Promise.resolve(v) })
const json = (body: unknown, method = 'POST') =>
  new NextRequest('http://x/api', { method, body: JSON.stringify(body) })

describe('/api/spaces/[spaceId]/agents', () => {
  beforeEach(() => jest.clearAllMocks())

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
    p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1' })
    ;(revokeAgentToken as jest.Mock).mockResolvedValue(false)
    const res = await revokeToken(
      new NextRequest('http://x/api', { method: 'DELETE' }),
      params({ spaceId: 'sp1', agentId: 'ag1', tokenId: 't-other' })
    )
    expect(res.status).toBe(404)
    expect(revokeAgentToken).toHaveBeenCalledWith('ag1', 't-other')
  })

  it('토큰은 한 번만 응답하고 no-store', async () => {
    admin.mockResolvedValue({ userId: 'u1' })
    p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1' })
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
    p.spaceAgent.findFirst.mockResolvedValue({ id: 'ag1' })
    const res = await issueToken(
      json({ expiresInDays: days }),
      params({ spaceId: 'sp1', agentId: 'ag1' })
    )
    expect(res.status).toBe(400)
    expect(issueAgentToken).not.toHaveBeenCalled()
  })
})
