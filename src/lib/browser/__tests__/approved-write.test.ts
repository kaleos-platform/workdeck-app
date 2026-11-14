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
import {
  claimBrowserWrite,
  reportBrowserWrite,
  recoverUnstartedBrowserWrite,
  roundtripParams,
} from '../approved-write'

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

const aborted = {
  claimId: 'claim-1',
  outcome: 'ABORTED',
  taskSpaceId: null,
  taskSpaceFinished: true,
}
const recovery = {
  attempt: 1,
  previousReport: aborted,
  recoveredAt: '2026-11-14T14:25:00.000Z',
  tokenId: 'token-1',
  claimId: 'claim-1',
}

it('미시작 중단은 동일 소유자의 원본 보고서·만료·승인 상태 CAS로 한 번만 복구한다', async () => {
  db.findFirst.mockResolvedValue({ report: aborted } as never)
  db.updateMany.mockResolvedValue({ count: 1 })
  await expect(
    recoverUnstartedBrowserWrite('space-1', 'token-1', 'job-1', { claimId: 'claim-1' })
  ).resolves.toEqual({ jobId: 'job-1', browserStatus: 'PENDING', recoveryAttempt: 1 })
  expect(db.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        id: 'job-1',
        spaceId: 'space-1',
        status: 'ABORTED',
        claimedByTokenId: 'token-1',
        claimId: 'claim-1',
        expiresAt: { gt: expect.any(Date) },
        action: { status: 'EXECUTED' },
      }),
    })
  )
  expect(db.updateMany).toHaveBeenCalledWith({
    where: expect.objectContaining({
      id: 'job-1',
      spaceId: 'space-1',
      status: 'ABORTED',
      claimedByTokenId: 'token-1',
      claimId: 'claim-1',
      report: { equals: aborted },
      expiresAt: { gt: expect.any(Date) },
      action: { status: 'EXECUTED' },
    }),
    data: {
      status: 'PENDING',
      claimedAt: null,
      claimedByTokenId: null,
      claimId: null,
      report: { ...aborted, recovery: { ...recovery, recoveredAt: expect.any(String) } },
    },
  })
})

it.each([
  null,
  {},
  { ...aborted, extra: true },
  { ...aborted, outcome: 'UNCERTAIN' },
  { ...aborted, taskSpaceId: 1 },
  { ...aborted, taskSpaceFinished: false },
  { ...aborted, claimId: 'other' },
  { ...aborted, recovery },
  { ...aborted, writtenSha256: 'b'.repeat(64) },
  { ...aborted, restoredSha256: 'a'.repeat(64) },
])('손상·브라우저 시작·변경 흔적·기복구 보고서는 복구하지 않는다: %j', async (report) => {
  db.findFirst.mockResolvedValue({ report } as never)
  await expect(
    recoverUnstartedBrowserWrite('space-1', 'token-1', 'job-1', { claimId: 'claim-1' })
  ).rejects.toThrow()
  expect(db.updateMany).not.toHaveBeenCalled()
})

it('미소유·만료·액션 상태 불일치와 동시 복구 패자는 거부한다', async () => {
  db.findFirst.mockResolvedValue(null)
  await expect(
    recoverUnstartedBrowserWrite('space-1', 'token-1', 'job-1', { claimId: 'claim-1' })
  ).rejects.toThrow()
  db.findFirst.mockResolvedValue({ report: aborted } as never)
  db.updateMany.mockResolvedValue({ count: 0 })
  await expect(
    recoverUnstartedBrowserWrite('space-1', 'token-1', 'job-1', { claimId: 'claim-1' })
  ).rejects.toThrow()
})

it.each([{}, { claimId: '' }, { claimId: 'claim-1', expiresAt: '2099' }])(
  '복구 입력은 claimId만 허용한다: %j',
  async (input) => {
    await expect(
      recoverUnstartedBrowserWrite('space-1', 'token-1', 'job-1', input)
    ).rejects.toThrow()
    expect(db.findFirst).not.toHaveBeenCalled()
  }
)

it.each([null, { ...aborted, recovery }])(
  'claim 응답은 서버에 보존된 복구 횟수를 전달한다',
  async (report) => {
    db.findFirst.mockResolvedValue({ id: 'job-1' } as never)
    db.updateMany.mockResolvedValue({ count: 1 })
    db.findUnique.mockResolvedValue({ id: 'job-1', report } as never)
    const result = await claimBrowserWrite('space-1', 'token-1')
    expect(result).toEqual({ id: 'job-1', recoveryAttempt: report ? 1 : 0 })
  }
)

it('복구 실행의 최종 보고에도 서버 복구 이력을 보존한다', async () => {
  db.findFirst.mockResolvedValue({ payload: params, report: { ...aborted, recovery } } as never)
  db.updateMany.mockResolvedValue({ count: 1 })
  const final = { ...aborted, claimId: 'claim-2' }
  await reportBrowserWrite('space-1', 'token-1', 'job-1', final)
  expect(db.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: { status: 'ABORTED', finishedAt: expect.any(Date), report: { ...final, recovery } },
    })
  )
})

it('DB 조회 중 만료되면 CAS는 조회 시각보다 새로운 시각으로 만료를 재검사한다', async () => {
  jest.useFakeTimers()
  try {
    jest.setSystemTime(new Date('2026-11-14T14:30:00.000Z'))
    db.findFirst.mockImplementationOnce(() => {
      jest.setSystemTime(new Date('2026-11-14T14:30:10.000Z'))
      return Promise.resolve({ report: aborted }) as never
    })
    db.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      recoverUnstartedBrowserWrite('space-1', 'token-1', 'job-1', { claimId: 'claim-1' })
    ).rejects.toThrow()
    expect(db.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ expiresAt: { gt: new Date('2026-11-14T14:30:10.000Z') } }),
      })
    )
  } finally {
    jest.useRealTimers()
  }
})

it('손상된 복구 이력은 claim·report에서 일반 작업으로 낮추지 않는다', async () => {
  const damaged = { ...aborted, recovery: { ...recovery, attempt: 2 } }
  db.findFirst.mockResolvedValue({ id: 'job-1', payload: params, report: damaged } as never)
  db.findUnique.mockResolvedValue({ id: 'job-1', report: damaged } as never)
  db.updateMany.mockResolvedValue({ count: 1 })
  await expect(claimBrowserWrite('space-1', 'token-1')).rejects.toThrow()
  db.updateMany.mockClear()
  await expect(reportBrowserWrite('space-1', 'token-1', 'job-1', aborted)).rejects.toThrow()
  expect(db.updateMany).not.toHaveBeenCalled()
})
