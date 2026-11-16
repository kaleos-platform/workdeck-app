/** @jest-environment node */
jest.mock('@/lib/worker-auth', () => ({ authenticateWorker: jest.fn() }))
jest.mock('@/lib/browser/approved-write', () => ({
  claimBrowserWrite: jest.fn(),
  reportBrowserWrite: jest.fn(),
  browserWriteReport: { safeParse: jest.fn() },
  recoverUnstartedBrowserWrite: jest.fn(),
  recoverUnstartedInput: jest.requireActual('@/lib/browser/approved-write').recoverUnstartedInput,
}))
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWorker } from '@/lib/worker-auth'
import {
  claimBrowserWrite,
  reportBrowserWrite,
  recoverUnstartedBrowserWrite,
} from '../approved-write'
import { POST as claim } from '../../../../app/api/browser/write-jobs/claim/route'
import { POST as report } from '../../../../app/api/browser/write-jobs/[id]/report/route'

import { POST as recover } from '../../../../app/api/browser/write-jobs/[id]/recover-unstarted/route'

const auth = jest.mocked(authenticateWorker)
beforeEach(() => jest.clearAllMocks())
it('세션·키 없음은 인증 단계에서 거부한다', async () => {
  auth.mockResolvedValue({ error: NextResponse.json({}, { status: 401 }) })
  expect(
    (
      await claim(
        new NextRequest('https://workdeck.test/api/browser/write-jobs/claim', { method: 'POST' })
      )
    ).status
  ).toBe(401)
  expect(claimBrowserWrite).not.toHaveBeenCalled()
})
it('레거시 전역 worker key는 claim과 report 모두 거부한다', async () => {
  auth.mockResolvedValue({ scope: { kind: 'legacy' } })
  const request = new NextRequest('https://workdeck.test/api/browser/write-jobs/claim', {
    method: 'POST',
  })
  expect((await claim(request)).status).toBe(403)
  expect((await report(request, { params: Promise.resolve({ id: 'job-1' }) })).status).toBe(403)
  expect(claimBrowserWrite).not.toHaveBeenCalled()
  expect(reportBrowserWrite).not.toHaveBeenCalled()
})
it('body의 Space 대신 인증된 Space와 token ID로만 claim한다', async () => {
  auth.mockResolvedValue({
    scope: { kind: 'space', spaceId: 'trusted-space', tokenId: 'trusted-token', workspaceId: null },
  })
  jest.mocked(claimBrowserWrite).mockResolvedValue(null)
  const request = new NextRequest('https://workdeck.test/api/browser/write-jobs/claim', {
    method: 'POST',
    body: JSON.stringify({ spaceId: 'other-space' }),
  })
  expect((await claim(request)).status).toBe(200)
  expect(claimBrowserWrite).toHaveBeenCalledWith('trusted-space', 'trusted-token')
})

const recoveryRequest = (body: unknown) =>
  new NextRequest('https://workdeck.test/api/browser/write-jobs/job-1/recover-unstarted', {
    method: 'POST',
    body: JSON.stringify(body),
  })
const context = { params: Promise.resolve({ id: 'job-1' }) }
it('복구도 세션·전역 키는 거부하고 Space WorkerToken만 받는다', async () => {
  auth.mockResolvedValue({ error: NextResponse.json({}, { status: 401 }) })
  expect((await recover(recoveryRequest({ claimId: 'claim-1' }), context)).status).toBe(401)
  auth.mockResolvedValue({ scope: { kind: 'legacy' } })
  expect((await recover(recoveryRequest({ claimId: 'claim-1' }), context)).status).toBe(403)
  expect(recoverUnstartedBrowserWrite).not.toHaveBeenCalled()
})
it('복구는 인증된 Space·토큰과 claimId만 전달한다', async () => {
  auth.mockResolvedValue({
    scope: { kind: 'space', spaceId: 'trusted-space', tokenId: 'trusted-token', workspaceId: null },
  })
  jest
    .mocked(recoverUnstartedBrowserWrite)
    .mockResolvedValue({ jobId: 'job-1', browserStatus: 'PENDING', recoveryAttempt: 1 })
  expect((await recover(recoveryRequest({ claimId: 'claim-1' }), context)).status).toBe(200)
  expect(recoverUnstartedBrowserWrite).toHaveBeenCalledWith(
    'trusted-space',
    'trusted-token',
    'job-1',
    { claimId: 'claim-1' }
  )
})
it.each([
  {},
  { claimId: '' },
  { claimId: 'c', spaceId: 'other' },
  { claimId: 'c', expiresAt: '2099' },
])('추가 필드·손상된 복구 입력은 거부한다: %j', async (body) => {
  auth.mockResolvedValue({
    scope: { kind: 'space', spaceId: 's', tokenId: 't', workspaceId: null },
  })
  expect((await recover(recoveryRequest(body), context)).status).toBe(400)
  expect(recoverUnstartedBrowserWrite).not.toHaveBeenCalled()
})
it('복구 충돌은 409이며 내부 오류는 500이다', async () => {
  auth.mockResolvedValue({
    scope: { kind: 'space', spaceId: 's', tokenId: 't', workspaceId: null },
  })
  const { ToolUserError } = await import('@/lib/agent/tools/errors')
  jest
    .mocked(recoverUnstartedBrowserWrite)
    .mockRejectedValueOnce(new ToolUserError('복구 불가'))
    .mockRejectedValueOnce(new Error('db'))
  expect((await recover(recoveryRequest({ claimId: 'c' }), context)).status).toBe(409)
  expect((await recover(recoveryRequest({ claimId: 'c' }), context)).status).toBe(500)
})
