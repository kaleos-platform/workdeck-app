import { listPostingPage } from '../posting-list'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: { hiringPosting: { findMany: jest.fn(), count: jest.fn() } },
}))

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.hiringPosting.findMany as jest.Mock).mockResolvedValue([{ id: 'posting-501' }])
  ;(prisma.hiringPosting.count as jest.Mock).mockResolvedValue(501)
})

it('장소와 직무명 및 고용 형태를 같은 공간의 공고에 함께 적용한다', async () => {
  const result = await listPostingPage('space-qa', {
    store: ' 강남 ',
    position: '서빙',
    jobType: 'PART_TIME',
    page: '2',
  })
  expect(result).toMatchObject({ store: '강남', position: '서빙', jobType: 'PART_TIME', page: 2 })
  const args = (prisma.hiringPosting.findMany as jest.Mock).mock.calls[0][0]
  expect(args.where).toMatchObject({
    spaceId: 'space-qa',
    stores: { some: { store: { name: { contains: '강남', mode: 'insensitive' } } } },
    positions: { some: { name: { contains: '서빙', mode: 'insensitive' }, jobType: 'PART_TIME' } },
  })
  expect(prisma.hiringPosting.count).toHaveBeenCalledWith({ where: args.where })
})

it('501번째 공고까지 공간·검색·상태 조건을 동일하게 적용해 조회한다', async () => {
  const result = await listPostingPage('space-qa', { q: '  강남  ', status: 'DRAFT', page: '11' })
  expect(result).toMatchObject({
    page: 11,
    pageSize: 50,
    total: 501,
    q: '강남',
    status: 'DRAFT',
    rows: [{ id: 'posting-501' }],
  })
  const args = (prisma.hiringPosting.findMany as jest.Mock).mock.calls[0][0]
  expect(args).toMatchObject({
    where: {
      spaceId: 'space-qa',
      status: 'DRAFT',
      title: { contains: '강남', mode: 'insensitive' },
    },
    skip: 500,
    take: 50,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  expect(prisma.hiringPosting.count).toHaveBeenCalledWith({ where: args.where })
})

it.each(['0', '-1', '1.5', 'Infinity', '9999999999999999999'])(
  '잘못된 page %s를 첫 페이지로 정규화한다',
  async (page) => {
    const result = await listPostingPage('space-qa', { q: ' ', status: 'invalid', page })
    expect(result).toMatchObject({ page: 1, q: '', status: 'ALL' })
    expect(prisma.hiringPosting.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 'space-qa' }, skip: 0 })
    )
  }
)
