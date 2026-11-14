/** @jest-environment node */
import { buildApplicationListWhere, countApplicationsByStatus } from '../applications'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringApplication: { groupBy: jest.fn() },
    hiringPostingPosition: { findMany: jest.fn() },
  },
}))

beforeAll(() => {
  process.env.HIRING_HMAC_KEY = 'ab'.repeat(32)
})
beforeEach(() => jest.clearAllMocks())

const from = new Date('2026-11-01T00:00:00Z')
const to = new Date('2026-11-10T00:00:00Z')

it('공고·기간·상태·진행 단계를 where 에 포함한다', async () => {
  const where = await buildApplicationListWhere('s1', {
    postingId: 'p1',
    from,
    to,
    stage: 'HIRING',
    process: 'INTERVIEW',
  })
  expect(where).toMatchObject({
    spaceId: 's1',
    deletedAt: null,
    postingId: 'p1',
    stage: 'HIRING',
    hiringStage: 'INTERVIEW',
    createdAt: { gte: from, lte: to },
  })
})

it('검색 토큰이 where 에 반영된다', async () => {
  const where = await buildApplicationListWhere('s1', { search: 'invalid' })
  expect(where).toMatchObject({ id: { in: [] } })
})

it('카운트는 groupBy 1회로 6개 값을 접고 stage/process 조건을 쓰지 않는다', async () => {
  ;(prisma.hiringApplication.groupBy as jest.Mock).mockResolvedValue([
    { stage: 'HIRING', hiringStage: 'APPLIED', _count: 4 },
    { stage: 'HIRING', hiringStage: 'INTERVIEW', _count: 2 },
    { stage: 'HIRING', hiringStage: 'JOB_OFFER', _count: 1 },
    { stage: 'ACCEPTED', hiringStage: 'JOB_OFFER', _count: 3 },
    { stage: 'REJECTED', hiringStage: 'APPLIED', _count: 5 },
  ])
  const counts = await countApplicationsByStatus('s1', { postingId: 'p1', from, to })
  expect(counts).toEqual({
    all: 15,
    APPLIED: 4,
    INTERVIEW: 2,
    JOB_OFFER: 1,
    ACCEPTED: 3,
    REJECTED: 5,
  })
  expect(prisma.hiringApplication.groupBy).toHaveBeenCalledTimes(1)
  const arg = (prisma.hiringApplication.groupBy as jest.Mock).mock.calls[0][0]
  expect(arg.by).toEqual(['stage', 'hiringStage'])
  expect(arg.where).toMatchObject({
    spaceId: 's1',
    postingId: 'p1',
    createdAt: { gte: from, lte: to },
  })
  expect(arg.where).not.toHaveProperty('stage')
  expect(arg.where).not.toHaveProperty('hiringStage')
})
