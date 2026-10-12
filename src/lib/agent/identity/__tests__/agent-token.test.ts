/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    agentToken: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  AGENT_TOKEN_PREFIX,
  hashTokenSecret,
  issueAgentToken,
  parseAgentToken,
  revokeAgentToken,
  verifyAgentToken,
} from '../agent-token'
import { parseScopes } from '../principal'

const p = prisma as unknown as {
  agentToken: { create: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock }
}
const NOW = new Date('2026-10-09T00:00:00Z')
const TID = 'c'.repeat(25) // cuid 길이(TOKEN_RE는 20–40자)
const DAY = 24 * 3600 * 1000

function row(over: Record<string, unknown> = {}, agentOver: Record<string, unknown> = {}) {
  return {
    id: TID,
    tokenHash: hashTokenSecret('s'.repeat(43)),
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    revokedAt: null,
    lastUsedAt: null,
    agent: {
      id: 'ag1',
      spaceId: 'sp1',
      kind: 'agent',
      scopes: ['ads:read'],
      status: 'ACTIVE',
      ...agentOver,
    },
    ...over,
  }
}

describe('agent-token', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    p.agentToken.updateMany.mockResolvedValue({ count: 1 })
    p.agentToken.create.mockImplementation(async () => ({ id: TID }))
  })

  it('발급 토큰은 prefix.id.secret 형식이고 DB에는 해시만 저장된다', async () => {
    const r = await issueAgentToken('ag1', { expiresInDays: 30 })
    expect(r.token.startsWith(`${AGENT_TOKEN_PREFIX}${TID}.`)).toBe(true)
    const secret = r.token.split('.')[1]
    const saved = p.agentToken.create.mock.calls[0][0].data
    expect(saved.tokenHash).toBe(hashTokenSecret(secret))
    expect(JSON.stringify(saved)).not.toContain(secret)
    expect(parseAgentToken(r.token)).toEqual({ tokenId: TID, secret })
  })

  it('expiresAt은 항상 설정된다 — 기본 365일, 지정 시 그 일수', async () => {
    const before = Date.now()
    const def = await issueAgentToken('ag1')
    expect(def.expiresAt).toBeInstanceOf(Date)
    expect(def.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 365 * DAY)
    expect(def.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 365 * DAY)
    expect(p.agentToken.create.mock.calls[0][0].data.expiresAt).toEqual(def.expiresAt)

    const short = await issueAgentToken('ag1', { expiresInDays: 1 })
    expect(short.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + DAY)
  })

  it.each([0, 366, 1.5, -1])('expiresInDays=%p 이면 발급하지 않는다', async (days) => {
    await expect(issueAgentToken('ag1', { expiresInDays: days })).rejects.toThrow()
    expect(p.agentToken.create).not.toHaveBeenCalled()
  })

  it('형식이 틀린 토큰은 파싱 실패', () => {
    expect(parseAgentToken('wdk_agt_abc')).toBeNull()
    expect(parseAgentToken('Bearer x')).toBeNull()
    expect(parseAgentToken(`wdk_agt_${TID}.${'s'.repeat(43)}`)).toEqual({
      tokenId: TID,
      secret: 's'.repeat(43),
    })
  })

  it('정상 토큰 → principal', async () => {
    p.agentToken.findUnique.mockResolvedValue(row())
    await expect(verifyAgentToken(`wdk_agt_${TID}.${'s'.repeat(43)}`, NOW)).resolves.toEqual({
      spaceId: 'sp1',
      actor: { type: 'agent', id: 'ag1' },
      scopes: ['ads:read'],
    })
  })

  it.each([
    ['폐기된 토큰', row({ revokedAt: new Date('2026-10-01') })],
    ['만료된 토큰', row({ expiresAt: new Date('2026-10-01') })],
    ['만료 시각이 없는 토큰', row({ expiresAt: null })],
    ['비활성 에이전트', row({}, { status: 'DISABLED' })],
    ['알 수 없는 kind', row({}, { kind: 'user' })],
  ])('%s → null', async (_label, r) => {
    p.agentToken.findUnique.mockResolvedValue(r)
    await expect(verifyAgentToken(`wdk_agt_${TID}.${'s'.repeat(43)}`, NOW)).resolves.toBeNull()
  })

  it('행이 없으면 null', async () => {
    p.agentToken.findUnique.mockResolvedValue(null)
    await expect(verifyAgentToken(`wdk_agt_${TID}.${'s'.repeat(43)}`, NOW)).resolves.toBeNull()
  })

  it('secret이 다르면 null', async () => {
    p.agentToken.findUnique.mockResolvedValue(row())
    await expect(verifyAgentToken(`wdk_agt_${TID}.${'x'.repeat(43)}`, NOW)).resolves.toBeNull()
  })

  it('폐기는 해당 에이전트의 미폐기 토큰에만 적용된다', async () => {
    p.agentToken.updateMany.mockResolvedValue({ count: 0 })
    await expect(revokeAgentToken('ag1', TID)).resolves.toBe(false)
    expect(p.agentToken.updateMany.mock.calls[0][0].where).toEqual({
      id: TID,
      agentId: 'ag1',
      revokedAt: null,
    })
  })

  it('알 수 없는 scope는 거부한다', () => {
    expect(() => parseScopes(['ads:read', 'root:all'])).toThrow('알 수 없는 scope: root:all')
  })
})
