/** @jest-environment node */
// /api/slack/channels — kind 파라미터화(approvals|notifications) 회귀.
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

jest.mock('@/lib/prisma', () => ({
  prisma: {
    slackInstallation: { findUnique: jest.fn() },
    spaceSlackChannel: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  },
}))

import { getUser } from '@/hooks/use-user'
import { resolveSpaceContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { GET, POST, DELETE } from '../route'

const mockGetUser = getUser as jest.Mock
const mockResolveSpaceContext = resolveSpaceContext as jest.Mock
const mockPrisma = prisma as unknown as {
  slackInstallation: { findUnique: jest.Mock }
  spaceSlackChannel: { findMany: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock }
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/slack/channels', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function deleteReq(qs: string) {
  return new NextRequest(`http://localhost/api/slack/channels${qs}`, { method: 'DELETE' })
}

describe('/api/slack/channels', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetUser.mockResolvedValue({ id: 'user-1' })
    mockResolveSpaceContext.mockResolvedValue({
      user: { id: 'user-1' },
      space: { id: 'space-1' },
      role: 'ADMIN',
    })
  })

  test('GET — 필터 없이 전체 kind 채널을 반환(변경 없음)', async () => {
    mockPrisma.slackInstallation.findUnique.mockResolvedValue({ teamName: 'Acme' })
    mockPrisma.spaceSlackChannel.findMany.mockResolvedValue([
      { id: '1', channelId: 'C1', channelName: null, kind: 'approvals', createdAt: new Date() },
      { id: '2', channelId: 'C2', channelName: null, kind: 'notifications', createdAt: new Date() },
    ])
    const res = await GET()
    const json = await res!.json()
    expect(json.installed).toBe(true)
    expect(json.channels).toHaveLength(2)
  })

  test('POST — kind 미지정 시 approvals로 upsert(하위 호환)', async () => {
    mockPrisma.slackInstallation.findUnique.mockResolvedValue({ spaceId: 'space-1' })
    mockPrisma.spaceSlackChannel.upsert.mockResolvedValue({
      id: '1',
      channelId: 'C1',
      channelName: null,
      kind: 'approvals',
    })

    const res = await POST(postReq({ channelId: 'C1' }))
    expect(res!.status).toBe(200)
    expect(mockPrisma.spaceSlackChannel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { spaceId_kind: { spaceId: 'space-1', kind: 'approvals' } },
      })
    )
  })

  test('POST — kind=notifications 지정 시 해당 kind로 upsert', async () => {
    mockPrisma.slackInstallation.findUnique.mockResolvedValue({ spaceId: 'space-1' })
    mockPrisma.spaceSlackChannel.upsert.mockResolvedValue({
      id: '2',
      channelId: 'C2',
      channelName: null,
      kind: 'notifications',
    })

    const res = await POST(postReq({ channelId: 'C2', kind: 'notifications' }))
    expect(res!.status).toBe(200)
    expect(mockPrisma.spaceSlackChannel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { spaceId_kind: { spaceId: 'space-1', kind: 'notifications' } },
      })
    )
  })

  test('POST — 잘못된 kind는 400', async () => {
    const res = await POST(postReq({ channelId: 'C1', kind: 'bogus' }))
    expect(res!.status).toBe(400)
    expect(mockPrisma.spaceSlackChannel.upsert).not.toHaveBeenCalled()
  })

  test('DELETE — kind 미지정 시 approvals만 제거(하위 호환)', async () => {
    mockPrisma.spaceSlackChannel.deleteMany.mockResolvedValue({ count: 1 })
    const res = await DELETE(deleteReq(''))
    expect(res!.status).toBe(200)
    expect(mockPrisma.spaceSlackChannel.deleteMany).toHaveBeenCalledWith({
      where: { spaceId: 'space-1', kind: 'approvals' },
    })
  })

  test('DELETE — ?kind=notifications 지정 시 해당 kind만 제거', async () => {
    mockPrisma.spaceSlackChannel.deleteMany.mockResolvedValue({ count: 1 })
    const res = await DELETE(deleteReq('?kind=notifications'))
    expect(res!.status).toBe(200)
    expect(mockPrisma.spaceSlackChannel.deleteMany).toHaveBeenCalledWith({
      where: { spaceId: 'space-1', kind: 'notifications' },
    })
  })

  test('DELETE — 잘못된 kind는 400', async () => {
    const res = await DELETE(deleteReq('?kind=bogus'))
    expect(res!.status).toBe(400)
    expect(mockPrisma.spaceSlackChannel.deleteMany).not.toHaveBeenCalled()
  })
})
