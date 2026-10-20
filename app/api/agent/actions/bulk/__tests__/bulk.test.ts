/** @jest-environment node */
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn(async () => ({ id: 'user-1' })) }))
jest.mock('@/lib/api-helpers', () => ({
  errorResponse: (message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    agentPendingAction: { findUnique: jest.fn() },
    spaceMember: { findUnique: jest.fn() },
  },
}))
jest.mock('@/lib/agent/actions/execute', () => ({
  approveAndExecute: jest.fn(),
  rejectAction: jest.fn(),
}))
jest.mock('@/lib/slack/sync-decision', () => ({ syncSlackDecision: jest.fn() }))

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { approveAndExecute, rejectAction } from '@/lib/agent/actions/execute'
import { syncSlackDecision } from '@/lib/slack/sync-decision'
import { POST } from '../route'

const findAction = prisma.agentPendingAction.findUnique as jest.Mock
const findMember = prisma.spaceMember.findUnique as jest.Mock

// act-a·act-b는 sp-1, act-c는 sp-2(호출자 미가입).
const SPACES: Record<string, string> = { 'act-a': 'sp-1', 'act-b': 'sp-1', 'act-c': 'sp-2' }

const call = (body: unknown) =>
  POST(
    new NextRequest('http://x/api/agent/actions/bulk', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  jest.clearAllMocks()
  findAction.mockImplementation(async ({ where }: { where: { id: string } }) =>
    SPACES[where.id] ? { id: where.id, spaceId: SPACES[where.id], actionType: 't' } : null
  )
  findMember.mockImplementation(
    async ({ where }: { where: { spaceId_userId: { spaceId: string } } }) =>
      where.spaceId_userId.spaceId === 'sp-1' ? { role: 'ADMIN' } : null
  )
})

it('멤버십은 각 액션의 spaceId로 확인한다 — 미가입 Space 액션은 forbidden, 실행하지 않는다', async () => {
  ;(approveAndExecute as jest.Mock).mockResolvedValue({
    ok: true,
    status: 'EXECUTED',
    result: null,
  })
  const { results } = await (
    await call({ action: 'approve', actionIds: ['act-a', 'act-c'] })
  ).json()

  expect(findMember).toHaveBeenCalledWith(
    expect.objectContaining({ where: { spaceId_userId: { spaceId: 'sp-2', userId: 'user-1' } } })
  )
  expect(results.map((r: { status: string }) => r.status)).toEqual(['ok', 'forbidden'])
  expect(approveAndExecute).toHaveBeenCalledTimes(1)
  expect(approveAndExecute).toHaveBeenCalledWith('act-a', 'user-1')
})

it('OWNER가 필요한 항목은 건너뛰고(forbidden) 나머지는 계속 처리한다', async () => {
  ;(approveAndExecute as jest.Mock).mockImplementation(async (id: string) =>
    id === 'act-a'
      ? {
          ok: false,
          status: 'FORBIDDEN',
          message: '지출 제안은 OWNER(회사 대표 계정)만 승인할 수 있습니다.',
        }
      : { ok: true, status: 'EXECUTED', result: { token: 'x', accessToken: 'EAAB-raw' } }
  )
  const res = await call({ action: 'approve', actionIds: ['act-a', 'act-b', 'missing'] })
  expect(res.status).toBe(200)
  const text = await res.text()
  expect(text).not.toContain('EAAB-raw')
  const { results } = JSON.parse(text)
  expect(results).toEqual([
    expect.objectContaining({
      actionId: 'act-a',
      ok: false,
      status: 'forbidden',
      message: 'OWNER 승인 필요',
    }),
    expect.objectContaining({ actionId: 'act-b', ok: true, status: 'ok' }),
    expect.objectContaining({ actionId: 'missing', ok: false, status: 'not_found' }),
  ])
  // Slack 동기화는 실제로 결정된 항목만.
  expect(syncSlackDecision).toHaveBeenCalledTimes(1)
  expect(syncSlackDecision).toHaveBeenCalledWith('act-b')
})

it('거절 경로 — 항목마다 rejectAction + Slack 동기화, 이미 처리된 건은 conflict', async () => {
  ;(rejectAction as jest.Mock).mockImplementation(async (id: string) =>
    id === 'act-a'
      ? { ok: false, status: 'REJECTED' }
      : { ok: false, status: 'CONFLICT', message: '이미 처리된 액션입니다' }
  )
  const { results } = await (await call({ action: 'reject', actionIds: ['act-a', 'act-b'] })).json()
  expect(results.map((r: { status: string }) => r.status)).toEqual(['ok', 'conflict'])
  expect(approveAndExecute).not.toHaveBeenCalled()
  expect(syncSlackDecision).toHaveBeenCalledTimes(2)
})

it('항목 하나의 예외는 그 항목만 failed(일반 메시지), 배치는 계속된다', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  ;(approveAndExecute as jest.Mock)
    .mockRejectedValueOnce(new Error('db secret detail'))
    .mockResolvedValueOnce({ ok: true, status: 'EXECUTED', result: null })
  const res = await call({ action: 'approve', actionIds: ['act-a', 'act-b'] })
  expect(res.status).toBe(200)
  const text = await res.text()
  expect(text).not.toContain('db secret detail')
  expect(JSON.parse(text).results.map((r: { status: string }) => r.status)).toEqual([
    'failed',
    'ok',
  ])
})

it.each([
  ['20개 초과', { action: 'approve', actionIds: Array.from({ length: 21 }, (_, i) => `a${i}`) }],
  ['빈 목록', { action: 'approve', actionIds: [] }],
  ['중복', { action: 'approve', actionIds: ['act-a', 'act-a'] }],
  ['잘못된 action', { action: 'delete', actionIds: ['act-a'] }],
])('%s → 422', async (_label, body) => {
  expect((await call(body)).status).toBe(422)
  expect(findAction).not.toHaveBeenCalled()
})
