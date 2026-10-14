/** @jest-environment node */
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn(async () => ({ id: 'user-1' })) }))
jest.mock('@/lib/api-helpers', () => ({
  errorResponse: (message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    agentPendingAction: {
      findUnique: jest.fn(async () => ({ id: 'act-1', spaceId: 'sp-1', actionType: 't' })),
    },
    spaceMember: { findUnique: jest.fn(async () => ({ role: 'ADMIN' })) },
  },
}))
jest.mock('@/lib/agent/actions/execute', () => ({
  approveAndExecute: jest.fn(),
  rejectAction: jest.fn(),
}))
jest.mock('@/lib/slack/sync-decision', () => ({ syncSlackDecision: jest.fn() }))

import { NextRequest } from 'next/server'
import { approveAndExecute } from '@/lib/agent/actions/execute'
import { PATCH } from '../route'

const call = () =>
  PATCH(
    new NextRequest('http://x/api/agent/actions/act-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'approve' }),
    }),
    { params: Promise.resolve({ actionId: 'act-1' }) }
  )

it('실행 결과(result)의 비밀 값은 응답에서 가린다', async () => {
  ;(approveAndExecute as jest.Mock).mockResolvedValue({
    ok: true,
    status: 'EXECUTED',
    result: { id: 'c-1', accessToken: 'EAAB-raw', note: 'Bearer abc123' },
  })
  const text = await (await call()).text()
  expect(text).not.toContain('EAAB-raw')
  expect(text).not.toContain('abc123')
  expect(JSON.parse(text).outcome.result).toEqual({
    id: 'c-1',
    accessToken: '[redacted]',
    note: 'Bearer [redacted]',
  })
})

it('실패 오류 메시지의 토큰도 가린다', async () => {
  ;(approveAndExecute as jest.Mock).mockResolvedValue({
    ok: false,
    status: 'FAILED',
    error: 'upstream 401 access_token=EAAB-raw',
  })
  const text = await (await call()).text()
  expect(text).not.toContain('EAAB-raw')
  expect(JSON.parse(text).outcome.error).toContain('[redacted]')
})
