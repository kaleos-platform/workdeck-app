/** @jest-environment node */
import { runFeedbackCleanup } from '../cleanup'
import { prisma } from '@/lib/prisma'
import { removeFeedbackFiles } from '@/lib/feedback/storage'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    userFeedbackAttachment: { findMany: jest.fn(), updateMany: jest.fn() },
    feedbackFileDeletion: {
      findMany: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/lib/feedback/storage', () => ({ removeFeedbackFiles: jest.fn() }))

const att = prisma.userFeedbackAttachment as unknown as Record<string, jest.Mock>
const led = prisma.feedbackFileDeletion as unknown as Record<string, jest.Mock>
const remove = removeFeedbackFiles as jest.Mock
const DAY = 86_400_000
const now = new Date('2026-12-01T00:00:00Z')

beforeEach(() => {
  jest.resetAllMocks()
  att.findMany.mockResolvedValue([])
  att.updateMany.mockResolvedValue({ count: 0 })
  led.findMany.mockResolvedValue([])
  led.create.mockImplementation(async () => ({ id: `L${++seq}` }))
  ;(prisma.$transaction as unknown as jest.Mock).mockImplementation((fn) => fn(prisma))
})
let seq = 0

it('DONE는 30일, ON_HOLD는 90일 cutoff로만 조회하고 IN_PROGRESS는 조회하지 않는다', async () => {
  await runFeedbackCleanup(now)
  const wheres = att.findMany.mock.calls.map((c) => c[0].where.feedback)
  expect(wheres).toEqual([
    { status: 'DONE', closedAt: { lte: new Date(now.getTime() - 30 * DAY) } },
    { status: 'ON_HOLD', closedAt: { lte: new Date(now.getTime() - 90 * DAY) } },
  ])
  expect(att.findMany.mock.calls[0][0].take).toBe(100)
})

it('선점 updateMany가 상태·closedAt 조건을 다시 걸고, 0건이면 Storage를 부르지 않는다', async () => {
  att.findMany.mockResolvedValueOnce([{ id: 'a1' }])
  const r = await runFeedbackCleanup(now)
  const claim = att.updateMany.mock.calls[0][0]
  expect(claim.where).toMatchObject({
    id: { in: ['a1'] },
    deletedAt: null,
    feedback: { status: 'DONE', closedAt: { lte: new Date(now.getTime() - 30 * DAY) } },
  })
  expect(claim.data).toEqual({ deletedAt: now })
  expect(remove).not.toHaveBeenCalled()
  expect(r.expiredRemoved).toBe(0)
})

it('선점된 행만 읽어 삭제하고, 일부 실패는 실패분만 deletedAt null로 되돌린다', async () => {
  att.findMany
    .mockResolvedValueOnce([{ id: 'a1' }, { id: 'a2' }]) // DONE 후보
    .mockResolvedValueOnce([
      { id: 'a1', feedbackId: 'f1', path: 'p1', sizeBytes: 10 },
      { id: 'a2', feedbackId: 'f2', path: 'p2', sizeBytes: 20 },
    ]) // 선점분
    .mockResolvedValue([]) // ON_HOLD
  att.updateMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValue({ count: 1 })
  remove
    .mockResolvedValueOnce({ removed: ['p1'], failed: [] })
    .mockResolvedValueOnce({ removed: [], failed: ['p2'] })
  const r = await runFeedbackCleanup(now)
  expect(remove).toHaveBeenCalledWith(['p1'])
  expect(remove).toHaveBeenCalledWith(['p2'])
  expect(att.updateMany).toHaveBeenLastCalledWith({
    where: { id: { in: ['a2'] } },
    data: { deletedAt: null },
  })
  expect(r).toMatchObject({ expiredRemoved: 1, expiredFailed: 1 })
})

it('batch 상한을 DONE과 ON_HOLD가 나눠 쓴다', async () => {
  att.findMany.mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({ id: `a${i}` })))
  await runFeedbackCleanup(now, 100)
  // 선점 0건으로 끝나도 남은 batch 0이면 ON_HOLD 조회 안 함
  expect(att.findMany).toHaveBeenCalledTimes(1)
})

it('원장: 1시간 미만은 건너뛰고, 성공은 행 삭제, 실패는 attempts+1·lastError', async () => {
  led.findMany.mockResolvedValue([
    { id: 'l1', paths: ['x1', 'x2'] },
    { id: 'l2', paths: ['y1'] },
  ])
  remove
    .mockResolvedValueOnce({ removed: ['x1', 'x2'], failed: [] })
    .mockResolvedValueOnce({ removed: [], failed: ['y1'] })
  const r = await runFeedbackCleanup(now)
  expect(led.findMany.mock.calls[0][0]).toMatchObject({
    where: { createdAt: { lt: new Date(now.getTime() - 3_600_000) } },
    take: 100,
    orderBy: [{ attempts: 'asc' }, { createdAt: 'asc' }],
  })
  expect(led.delete).toHaveBeenCalledWith({ where: { id: 'l1' } })
  expect(led.update).toHaveBeenCalledWith({
    where: { id: 'l2' },
    data: { attempts: { increment: 1 }, lastError: expect.any(String) },
  })
  expect(led.update.mock.calls[0][0].data.lastError).not.toContain('y1')
  expect(r).toMatchObject({ ledgerDone: 1, ledgerFailed: 1 })
})

it('선점 tx가 그룹별 원장 행(paths·bytes)을 만들고, 성공하면 지운다', async () => {
  att.findMany
    .mockResolvedValueOnce([{ id: 'a1' }, { id: 'a2' }])
    .mockResolvedValueOnce([
      { id: 'a1', feedbackId: 'f1', path: 'p1', sizeBytes: 10 },
      { id: 'a2', feedbackId: 'f1', path: 'p2', sizeBytes: 20 },
    ])
    .mockResolvedValue([])
  att.updateMany.mockResolvedValueOnce({ count: 2 })
  remove.mockResolvedValue({ removed: ['p1', 'p2'], failed: [] })
  await runFeedbackCleanup(now)
  expect(led.create).toHaveBeenCalledWith({ data: { paths: ['p1', 'p2'], bytes: 30 } })
  expect(led.delete).toHaveBeenCalledWith({ where: { id: 'L' + seq } })
})

it('remove가 throw하면 그 그룹만 복구+원장 삭제, 다른 그룹은 영향 없음', async () => {
  att.findMany
    .mockResolvedValueOnce([{ id: 'a1' }, { id: 'a2' }])
    .mockResolvedValueOnce([
      { id: 'a1', feedbackId: 'f1', path: 'p1', sizeBytes: 1 },
      { id: 'a2', feedbackId: 'f2', path: 'p2', sizeBytes: 1 },
    ])
    .mockResolvedValue([])
  att.updateMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValue({ count: 1 })
  remove
    .mockRejectedValueOnce(new Error('net'))
    .mockResolvedValueOnce({ removed: ['p2'], failed: [] })
  const r = await runFeedbackCleanup(now)
  expect(att.updateMany).toHaveBeenLastCalledWith({
    where: { id: { in: ['a1'] } },
    data: { deletedAt: null },
  })
  expect(led.delete).toHaveBeenCalledTimes(2)
  expect(r).toMatchObject({ expiredRemoved: 1, expiredFailed: 1 })
})

it('원장 루프: remove throw 시 attempts+1 후 다음 행 계속', async () => {
  led.findMany.mockResolvedValue([
    { id: 'l1', paths: ['x'] },
    { id: 'l2', paths: ['y'] },
  ])
  remove
    .mockRejectedValueOnce(new Error('env'))
    .mockResolvedValueOnce({ removed: ['y'], failed: [] })
  const r = await runFeedbackCleanup(now)
  expect(led.update).toHaveBeenCalledWith({
    where: { id: 'l1' },
    data: { attempts: { increment: 1 }, lastError: expect.any(String) },
  })
  expect(led.delete).toHaveBeenCalledWith({ where: { id: 'l2' } })
  expect(r).toMatchObject({ ledgerDone: 1, ledgerFailed: 1 })
})

it('복구 count가 실패 건수보다 적으면(cascade 삭제) 원장 행을 지우지 않는다', async () => {
  att.findMany
    .mockResolvedValueOnce([{ id: 'a1' }])
    .mockResolvedValueOnce([{ id: 'a1', feedbackId: 'f1', path: 'p1', sizeBytes: 1 }])
    .mockResolvedValue([])
  att.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
  remove.mockResolvedValueOnce({ removed: [], failed: ['p1'] })
  await runFeedbackCleanup(now)
  expect(led.delete).not.toHaveBeenCalled()
})
