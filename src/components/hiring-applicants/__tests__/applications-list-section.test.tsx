import { ApplicationsListSection } from '../applications-list-section'
import { listApplications, countApplicationsByStatus } from '@/lib/hiring/applications'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/hiring/applications', () => ({
  listApplications: jest.fn(async () => ({ rows: [], total: 0 })),
  countApplicationsByStatus: jest.fn(async () => ({
    all: 0,
    APPLIED: 0,
    INTERVIEW: 0,
    JOB_OFFER: 0,
    ACCEPTED: 0,
    REJECTED: 0,
  })),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { hiringPosting: { findMany: jest.fn(async () => []) } },
}))
jest.mock('@/components/hiring-applicants/applications-table', () => ({
  ApplicationsTable: () => null,
}))

beforeEach(() => jest.clearAllMocks())

it('공고 고정 시 URL 의 posting 값을 무시하고 목록·카운트를 고정 공고로 조회한다', async () => {
  const element = await ApplicationsListSection({
    spaceId: 's1',
    canExportExcel: true,
    raw: { posting: 'other', stage: 'HIRING', process: 'INTERVIEW' },
    lockedPostingId: 'p1',
    basePath: '/d/recruiting/postings/p1',
    baseQuery: { tab: 'applicants' },
  })
  expect(listApplications).toHaveBeenCalledWith(
    's1',
    expect.objectContaining({ postingId: 'p1', stage: 'HIRING', process: 'INTERVIEW' })
  )
  expect(countApplicationsByStatus).toHaveBeenCalledWith(
    's1',
    expect.objectContaining({ postingId: 'p1' })
  )
  expect(prisma.hiringPosting.findMany).not.toHaveBeenCalled()
  expect(element.props).toMatchObject({
    lockedPostingId: 'p1',
    basePath: '/d/recruiting/postings/p1',
    baseQuery: { tab: 'applicants' },
    filters: expect.objectContaining({ posting: 'p1' }),
  })
})

it('고정하지 않으면 URL 의 posting 필터와 공고 목록을 사용한다', async () => {
  const element = await ApplicationsListSection({
    spaceId: 's1',
    canExportExcel: false,
    raw: { posting: 'x' },
  })
  expect(listApplications).toHaveBeenCalledWith('s1', expect.objectContaining({ postingId: 'x' }))
  expect(prisma.hiringPosting.findMany).toHaveBeenCalled()
  expect(element.props.lockedPostingId).toBeUndefined()
})
