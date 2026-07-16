/** @jest-environment node */
// /api/agent/settings — ADMIN 게이트 + isActive 기본값(true) + KST 사용량 조회 회귀.
// getUser · resolveSpaceContext · assertRole · prisma 모두 mock.

import { NextRequest } from 'next/server'

jest.mock('@/hooks/use-user', () => ({
  getUser: jest.fn(),
}))

jest.mock('@/lib/api-helpers', () => ({
  errorResponse: (msg: string, status: number) =>
    new Response(JSON.stringify({ message: msg }), { status }),
  assertRole: jest.fn(() => null),
  resolveSpaceContext: jest.fn(),
}))

jest.mock('@/lib/agent/llm/usage', () => ({
  todayKst: jest.fn(() => '2026-07-16'),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceAgent: { findUnique: jest.fn(), upsert: jest.fn() },
    agentLlmUsage: { findUnique: jest.fn() },
    slackInstallation: { findUnique: jest.fn() },
  },
}))

import { getUser } from '@/hooks/use-user'
import { assertRole, resolveSpaceContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { GET, PATCH } from '../route'

const mockGetUser = getUser as jest.Mock
const mockResolveSpaceContext = resolveSpaceContext as jest.Mock
const mockAssertRole = assertRole as jest.Mock
const mockPrisma = prisma as unknown as {
  spaceAgent: { findUnique: jest.Mock; upsert: jest.Mock }
  agentLlmUsage: { findUnique: jest.Mock }
  slackInstallation: { findUnique: jest.Mock }
}

describe('/api/agent/settings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetUser.mockResolvedValue({ id: 'user-1' })
    mockResolveSpaceContext.mockResolvedValue({
      user: { id: 'user-1' },
      space: { id: 'space-1' },
      role: 'ADMIN',
    })
    mockAssertRole.mockReturnValue(null)
  })

  test('GET — 인증 없으면 401', async () => {
    mockGetUser.mockResolvedValue(null)
    const res = await GET()
    expect(res!.status).toBe(401)
  })

  test('GET — ADMIN 미만이면 403', async () => {
    mockAssertRole.mockReturnValue(
      new Response(JSON.stringify({ message: '권한이 없습니다' }), { status: 403 })
    )
    const res = await GET()
    expect(res!.status).toBe(403)
  })

  test('GET — SpaceAgent 행이 없으면 agentActive 기본값 true', async () => {
    mockPrisma.spaceAgent.findUnique.mockResolvedValue(null)
    mockPrisma.agentLlmUsage.findUnique.mockResolvedValue(null)
    mockPrisma.slackInstallation.findUnique.mockResolvedValue(null)

    const res = await GET()
    const json = await res!.json()

    expect(json.agentActive).toBe(true)
    expect(json.usage).toEqual({
      requestCount: 0,
      dailyLimit: 50,
      inputTokens: 0,
      outputTokens: 0,
    })
  })

  test('GET — 오늘(KST) 사용량 조회 시 todayKst() 날짜 키를 그대로 사용', async () => {
    mockPrisma.spaceAgent.findUnique.mockResolvedValue({ isActive: false })
    mockPrisma.agentLlmUsage.findUnique.mockResolvedValue({
      requestCount: 3,
      inputTokens: 100,
      outputTokens: 50,
    })
    mockPrisma.slackInstallation.findUnique.mockResolvedValue({
      teamName: 'Acme',
      createdAt: new Date('2026-01-01'),
    })

    const res = await GET()
    const json = await res!.json()

    expect(mockPrisma.agentLlmUsage.findUnique).toHaveBeenCalledWith({
      where: { spaceId_date: { spaceId: 'space-1', date: '2026-07-16' } },
      select: { requestCount: true, inputTokens: true, outputTokens: true },
    })
    expect(json.agentActive).toBe(false)
    expect(json.usage.requestCount).toBe(3)
    expect(json.slack).toEqual({
      installed: true,
      teamName: 'Acme',
      connectedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  test('PATCH — agentActive 누락이면 400', async () => {
    const req = new NextRequest('http://localhost/api/agent/settings', {
      method: 'PATCH',
      body: JSON.stringify({}),
    })
    const res = await PATCH(req)
    expect(res!.status).toBe(400)
  })

  test('PATCH — agentActive:false upsert 후 반영값 반환', async () => {
    mockPrisma.spaceAgent.upsert.mockResolvedValue({ isActive: false })
    const req = new NextRequest('http://localhost/api/agent/settings', {
      method: 'PATCH',
      body: JSON.stringify({ agentActive: false }),
    })
    const res = await PATCH(req)
    const json = await res!.json()

    expect(mockPrisma.spaceAgent.upsert).toHaveBeenCalledWith({
      where: { spaceId: 'space-1' },
      create: { spaceId: 'space-1', isActive: false },
      update: { isActive: false },
      select: { isActive: true },
    })
    expect(json.agentActive).toBe(false)
  })
})
