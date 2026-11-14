/** @jest-environment node */
jest.mock('@/lib/worker-auth', () => ({ authenticateWorker: jest.fn() }))
jest.mock('@/lib/browser/approved-write', () => ({
  claimBrowserWrite: jest.fn(),
  reportBrowserWrite: jest.fn(),
  browserWriteReport: { safeParse: jest.fn() },
}))
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWorker } from '@/lib/worker-auth'
import { claimBrowserWrite, reportBrowserWrite } from '../approved-write'
import { POST as claim } from '../../../../app/api/browser/write-jobs/claim/route'
import { POST as report } from '../../../../app/api/browser/write-jobs/[id]/report/route'

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
