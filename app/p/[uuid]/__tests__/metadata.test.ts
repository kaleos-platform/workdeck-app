import { generateMetadata } from '../page'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({ prisma: { hiringPosting: { findUnique: jest.fn() } } }))
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))

const findUnique = jest.mocked(prisma.hiringPosting.findUnique)
const params = { params: Promise.resolve({ uuid: 'abc' }), searchParams: Promise.resolve({}) }

describe('공개 공고 메타데이터', () => {
  it.each(['DRAFT', 'ARCHIVED'])('%s 공고 제목을 노출하지 않는다', async (status) => {
    findUnique.mockResolvedValue({ title: '비공개 고객 공고', status } as never)
    expect(await generateMetadata(params)).toEqual({ title: '채용 공고' })
  })

  it.each(['ACTIVE', 'CLOSED'])('%s 공개 공고 제목을 유지한다', async (status) => {
    findUnique.mockResolvedValue({ title: '공개 공고', status } as never)
    expect(await generateMetadata(params)).toEqual({ title: '공개 공고 · 채용 공고' })
  })

  it('존재하지 않는 공고는 기본 제목을 사용한다', async () => {
    findUnique.mockResolvedValue(null)
    expect(await generateMetadata(params)).toEqual({ title: '채용 공고' })
  })
})
