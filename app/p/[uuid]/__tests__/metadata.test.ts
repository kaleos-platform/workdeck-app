import { generateMetadata } from '../page'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({ prisma: { hiringPosting: { findUnique: jest.fn() } } }))
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))

const findUnique = jest.mocked(prisma.hiringPosting.findUnique)
const params = { params: Promise.resolve({ uuid: 'abc' }), searchParams: Promise.resolve({}) }

const base = {
  title: '공개 공고',
  spaceId: 's',
  closingDate: null,
  space: { name: '카페' },
  contents: [],
  positions: [
    { spaceId: 's', name: '바리스타' },
    { spaceId: 'other', name: '타 공간 직무' },
  ],
  stores: [
    { store: { name: '본점', roadAddress: '서울 강남구 테헤란로 1', spaceId: 's' } },
    { store: { name: '타 공간 매장', roadAddress: '부산 어딘가 2', spaceId: 'other' } },
  ],
}

describe('공개 공고 메타데이터', () => {
  it.each(['DRAFT', 'ARCHIVED'])('%s 공고 제목을 노출하지 않는다', async (status) => {
    findUnique.mockResolvedValue({ ...base, title: '비공개 고객 공고', status } as never)
    expect(await generateMetadata(params)).toEqual({ title: '채용 공고' })
  })

  it('ACTIVE 공고는 설명·canonical·OG 를 내고 다른 공간 연결 행은 쓰지 않는다', async () => {
    findUnique.mockResolvedValue({ ...base, status: 'ACTIVE' } as never)
    const meta = await generateMetadata(params)
    expect(meta.title).toBe('공개 공고 · 채용 공고')
    expect(meta.description).toBe('카페 · 바리스타 · 서울 강남구 테헤란로 1')
    expect(meta.alternates?.canonical).toMatch(/\/p\/abc$/)
    expect(meta.openGraph).toMatchObject({ title: '공개 공고 · 채용 공고', type: 'website' })
    expect(meta.robots).toBeUndefined()
  })

  it('CLOSED 공고와 마감일이 지난 ACTIVE 공고는 noindex 이다', async () => {
    findUnique.mockResolvedValue({ ...base, status: 'CLOSED' } as never)
    expect((await generateMetadata(params)).robots).toEqual({ index: false })
    findUnique.mockResolvedValue({
      ...base,
      status: 'ACTIVE',
      closingDate: new Date('2020-01-01T00:00:00Z'),
    } as never)
    expect((await generateMetadata(params)).robots).toEqual({ index: false })
  })

  it('존재하지 않는 공고는 기본 제목을 사용한다', async () => {
    findUnique.mockResolvedValue(null)
    expect(await generateMetadata(params)).toEqual({ title: '채용 공고' })
  })
})
