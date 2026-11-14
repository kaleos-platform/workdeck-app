/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    browserWriteJob: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}))
import { prisma } from '@/lib/prisma'
import { claimBrowserWrite, reportBrowserWrite, roundtripParams } from '../approved-write'

const params = {
  identity: 'cafe24-admin',
  mallId: 'ameaning24',
  shopNo: 1,
  skinNo: 24,
  skinCode: 'skin15',
  file: '/index.html',
  originalSha256: 'a'.repeat(64),
  markerId: 'pilot-20261114',
}
const db = prisma.browserWriteJob as jest.Mocked<typeof prisma.browserWriteJob>
beforeEach(() => jest.clearAllMocks())

it('정확한 해시와 고정 HTML 주석 검증만 허용한다', () => {
  expect(roundtripParams.safeParse(params).success).toBe(true)
  for (const extra of [
    { file: '/../index.html' },
    { originalSha256: 'abc' },
    { markerId: '--><script>' },
    { skinNo: 0 },
    { mallId: 'other.com/' },
    { instructions: 'save arbitrary code' },
  ])
    expect(roundtripParams.safeParse({ ...params, ...extra }).success).toBe(false)
})

it('claim은 Space·대기·미만료 범위의 CAS 승자에게만 작업을 돌려준다', async () => {
  db.findFirst.mockResolvedValue({ id: 'job-1' } as never)
  db.updateMany.mockResolvedValue({ count: 0 })
  expect(await claimBrowserWrite('space-1', 'token-1')).toBeNull()
  expect(db.findUnique).not.toHaveBeenCalled()
  expect(db.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        spaceId: 'space-1',
        status: 'PENDING',
        expiresAt: { gt: expect.any(Date) },
        action: { status: 'EXECUTED' },
      }),
    })
  )
})

it('원본 복원 해시가 다르면 성공 보고를 거부한다', async () => {
  db.findFirst.mockResolvedValue({ id: 'job-1', payload: params } as never)
  await expect(
    reportBrowserWrite('space-1', 'token-1', 'job-1', {
      claimId: 'claim-1',
      outcome: 'RESTORED',
      originalSha256: 'a'.repeat(64),
      writtenSha256: 'b'.repeat(64),
      restoredSha256: 'c'.repeat(64),
      taskSpaceId: 171,
      taskSpaceFinished: true,
    })
  ).rejects.toThrow('복원')
  expect(db.updateMany).not.toHaveBeenCalled()
})

it('다른 토큰·다른 Space의 실행 보고는 상태를 바꾸지 않는다', async () => {
  db.findFirst.mockResolvedValue(null)
  await expect(
    reportBrowserWrite('space-2', 'token-2', 'job-1', {
      claimId: 'claim-1',
      outcome: 'UNCERTAIN',
      taskSpaceId: null,
      taskSpaceFinished: false,
    })
  ).rejects.toThrow('실행 중')
  expect(db.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        id: 'job-1',
        spaceId: 'space-2',
        status: 'RUNNING',
        claimedByTokenId: 'token-2',
        claimId: 'claim-1',
      },
    })
  )
})
