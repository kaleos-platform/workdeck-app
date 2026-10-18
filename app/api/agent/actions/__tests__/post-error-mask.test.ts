/** @jest-environment node */
jest.mock('@/lib/api-helpers', () => ({
  resolveRequestedSpaceContext: jest.fn(),
  errorResponse: (message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), { status }),
}))
jest.mock('@/lib/worker-auth', () => ({
  assertWorkerOwns: jest.fn(),
  authenticateWorker: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/agent/actions/create', () => ({ createPendingAction: jest.fn() }))
jest.mock('@/lib/agent/actions/execute', () => ({ expirePendingActions: jest.fn() }))
jest.mock('@/lib/agent/actions/actor-label', () => ({ describeActors: jest.fn() }))

import { NextRequest } from 'next/server'
import { resolveRequestedSpaceContext } from '@/lib/api-helpers'
import { createPendingAction } from '@/lib/agent/actions/create'
import { ToolUserError } from '@/lib/agent/tools/errors'
import { POST } from '../route'

const post = () =>
  POST(
    new NextRequest('http://x/api/agent/actions', {
      method: 'POST',
      body: JSON.stringify({ actionType: 't', params: {}, summary: 's' }),
    })
  )

beforeEach(() => {
  jest.resetAllMocks()
  ;(resolveRequestedSpaceContext as jest.Mock).mockResolvedValue({
    user: { id: 'u' },
    space: { id: 'sp-a', name: 'Space A' },
    role: 'ADMIN',
  })
})

it('검증 실패(ToolUserError)는 사유와 함께 400', async () => {
  ;(createPendingAction as jest.Mock).mockRejectedValue(
    new ToolUserError('알 수 없는 액션 유형: t')
  )
  const res = await post()
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: '알 수 없는 액션 유형: t' })
})

it('그 밖의 오류는 내부 메시지를 숨기고 500', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
  ;(createPendingAction as jest.Mock).mockRejectedValue(
    new Error('Invalid `prisma.agentPendingAction.create()` invocation: secret column')
  )
  const res = await post()
  expect(res.status).toBe(500)
  const body = await res.json()
  expect(JSON.stringify(body)).not.toContain('prisma')
  expect(spy).toHaveBeenCalled()
  spy.mockRestore()
})
