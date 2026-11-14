import { formatDday, getRecruitingHomeSummary } from '../home-summary'
import { prisma } from '@/lib/prisma'
import { countApplicationsByStatus } from '../applications'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringPosting: { findMany: jest.fn() },
    hiringApplication: { findMany: jest.fn(), groupBy: jest.fn() },
  },
}))
jest.mock('../applications', () => ({ countApplicationsByStatus: jest.fn() }))

const counts = (all: number) => ({
  all,
  APPLIED: 2,
  INTERVIEW: 1,
  JOB_OFFER: 0,
  ACCEPTED: 0,
  REJECTED: 0,
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(countApplicationsByStatus as jest.Mock).mockImplementation(async (_s, f) =>
    f.from ? counts(3) : counts(9)
  )
  ;(prisma.hiringApplication.findMany as jest.Mock).mockResolvedValue([])
})

it('공간 스코프로 요약을 만들고 공고별 진행 중 인원을 합친다', async () => {
  ;(prisma.hiringPosting.findMany as jest.Mock).mockResolvedValue([
    { id: 'p1', uuid: 'u1', title: 'A', closingDate: null },
    { id: 'p2', uuid: 'u2', title: 'B', closingDate: null },
  ])
  ;(prisma.hiringApplication.groupBy as jest.Mock).mockResolvedValue([
    { postingId: 'p1', _count: 4 },
  ])
  const r = await getRecruitingHomeSummary('space-1')
  expect(r.weekCount).toBe(3)
  expect(r.counts.all).toBe(9)
  expect(r.postings.map((p) => p.inProgress)).toEqual([4, 0])
  const where = (prisma.hiringPosting.findMany as jest.Mock).mock.calls[0][0].where
  expect(where).toMatchObject({ spaceId: 'space-1', status: 'ACTIVE' })
  expect((prisma.hiringApplication.groupBy as jest.Mock).mock.calls[0][0].where).toMatchObject({
    spaceId: 'space-1',
    deletedAt: null,
    stage: 'HIRING',
  })
  expect((prisma.hiringApplication.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
    spaceId: 'space-1',
    deletedAt: null,
  })
})

it('모집 중 공고가 없으면 groupBy 를 호출하지 않는다', async () => {
  ;(prisma.hiringPosting.findMany as jest.Mock).mockResolvedValue([])
  const r = await getRecruitingHomeSummary('space-1')
  expect(r.postings).toEqual([])
  expect(prisma.hiringApplication.groupBy).not.toHaveBeenCalled()
})

it('D-day 라벨', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-14T03:00:00Z'))
  expect(formatDday(null)).toBeNull()
  expect(formatDday(new Date('2026-11-14T00:00:00Z'))).toBe('D-day')
  expect(formatDday(new Date('2026-11-17T00:00:00Z'))).toBe('D-3')
  jest.useRealTimers()
})
