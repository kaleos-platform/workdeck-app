/** @jest-environment node */
jest.mock('@/lib/api-helpers', () => ({
  resolveRequestedSpaceContext: jest.fn(async () => ({ space: { id: 'sp-1' }, role: 'ADMIN' })),
  errorResponse: (message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), { status }),
}))
jest.mock('@/lib/worker-auth', () => ({
  assertWorkerOwns: jest.fn(),
  authenticateWorker: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({ prisma: { agentPendingAction: { findMany: jest.fn() } } }))
jest.mock('@/lib/agent/actions/create', () => ({ createPendingAction: jest.fn() }))
jest.mock('@/lib/agent/actions/execute', () => ({ expirePendingActions: jest.fn() }))
jest.mock('@/lib/agent/actions/actor-label', () => ({
  describeActors: jest.fn(async () => ['라벨']),
}))

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

it('GET 응답의 payload는 서버에서 비밀 값을 가린다', async () => {
  ;(prisma.agentPendingAction.findMany as jest.Mock).mockResolvedValue([
    {
      id: 'act-1',
      spaceId: 'sp-1',
      actionType: 'unknown.action',
      status: 'PENDING',
      payload: { campaignId: 'c-1', accessToken: 'EAAB-raw', note: 'Bearer abc123' },
      beforeState: null,
      result: null,
    },
  ])
  const res = await GET(new NextRequest('http://x/api/agent/actions?spaceId=sp-1'))
  const text = await res.text()
  expect(text).not.toContain('EAAB-raw')
  expect(text).not.toContain('abc123')
  const { actions } = JSON.parse(text)
  expect(actions[0].payload).toEqual({
    campaignId: 'c-1',
    accessToken: '[redacted]',
    note: 'Bearer [redacted]',
  })
  expect(actions[0].requiredRole).toBe('ADMIN')
  expect(actions[0].spendKrw).toBeNull()
})
