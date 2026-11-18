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
jest.mock('@/lib/prisma', () => ({
  prisma: {
    agentPendingAction: { findMany: jest.fn() },
    spaceAgent: { findMany: jest.fn(async () => [{ id: 'ag1', name: '에밀리' }]) },
    user: { findMany: jest.fn(async () => [{ id: 'admin1', name: '에디' }]) },
    space: { findUnique: jest.fn(async () => ({ approvalLimitKrw: 0 })) },
  },
}))
jest.mock('@/lib/agent/actions/create', () => ({ createPendingAction: jest.fn() }))
jest.mock('@/lib/agent/actions/execute', () => ({ expirePendingActions: jest.fn() }))
jest.mock('@/lib/agent/actions/actor-label', () => ({
  describeActors: jest.fn(async () => ['라벨']),
}))

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { describeActors } from '@/lib/agent/actions/actor-label'
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

it('GET 은 자동 실행 액션만 「에이전트 자동 생성 · 권한 부여: 관리자」로 표시하고 수동 승인은 기존 라벨을 둔다', async () => {
  const row = {
    spaceId: 'sp-1',
    actionType: 'unknown.action',
    payload: {},
    beforeState: null,
    result: null,
    actorType: 'agent',
    actorId: 'ag1',
    decidedBy: 'admin1',
    status: 'EXECUTED',
  }
  ;(prisma.agentPendingAction.findMany as jest.Mock).mockResolvedValue([
    { ...row, id: 'auto', autoExecuted: true },
    { ...row, id: 'manual', autoExecuted: false },
  ])
  ;(describeActors as jest.Mock).mockResolvedValueOnce(['라벨0', '라벨'])
  const res = await GET(new NextRequest('http://x/api/agent/actions?spaceId=sp-1'))
  const { actions } = await res.json()
  expect(actions[0].actorLabel).toBe('에밀리 자동 생성 · 권한 부여: 에디')
  expect(actions[0].autoExecuted).toBe(true)
  expect(actions[1].actorLabel).toBe('라벨')
})
