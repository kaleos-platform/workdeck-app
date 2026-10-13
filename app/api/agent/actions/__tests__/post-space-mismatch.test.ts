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
import { POST } from '../route'

describe('POST /api/agent/actions — 세션 요청의 spaceId', () => {
  it('query 와 body 의 spaceId 가 다르면 400, 액션을 만들지 않는다', async () => {
    const req = new NextRequest('http://x/api/agent/actions?spaceId=sp-a', {
      method: 'POST',
      body: JSON.stringify({ spaceId: 'sp-b', actionType: 't', params: {}, summary: 's' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(resolveRequestedSpaceContext).not.toHaveBeenCalled()
    expect(createPendingAction).not.toHaveBeenCalled()
  })
})
