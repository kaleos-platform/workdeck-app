import { render, screen } from '@testing-library/react'
import Page from '../page'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/hooks/use-user'
jest.mock('@/lib/prisma', () => ({
  prisma: { hiringPosting: { findUnique: jest.fn() }, spaceMember: { findFirst: jest.fn() } },
}))
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: () => {
    throw Error('404')
  },
  redirect: () => {
    throw Error('redirect')
  },
}))
jest.mock('@/components/hiring-public/apply-form', () => ({
  ApplyForm: () => <form aria-label="지원서" />,
}))
const props = { params: Promise.resolve({ uuid: 'qa' }), searchParams: Promise.resolve({}) }
beforeEach(() => jest.clearAllMocks())
it.each(['DRAFT', 'CLOSED'])(
  '%s는 개인정보 입력 없이 접수 불가 안내를 표시한다',
  async (status) => {
    jest
      .mocked(prisma.hiringPosting.findUnique)
      .mockResolvedValue({ status, title: '비공개 제목', spaceId: 's' } as never)
    render(await Page(props))
    expect(
      screen.getByRole('heading', { name: '현재 지원할 수 없는 공고입니다' })
    ).toBeInTheDocument()
    expect(screen.queryByText('비공개 제목')).not.toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  }
)
it('초안의 권한 없는 미리보기도 접수 불가 안내를 표시한다', async () => {
  jest.mocked(getUser).mockResolvedValue(null)
  jest
    .mocked(prisma.hiringPosting.findUnique)
    .mockResolvedValue({ status: 'DRAFT', spaceId: 's' } as never)
  render(await Page({ ...props, searchParams: Promise.resolve({ preview: '1' }) }))
  expect(
    screen.getByRole('heading', { name: '현재 지원할 수 없는 공고입니다' })
  ).toBeInTheDocument()
})
it('존재하지 않는 공고는 404를 유지한다', async () => {
  jest.mocked(prisma.hiringPosting.findUnique).mockResolvedValue(null)
  await expect(Page(props)).rejects.toThrow('404')
})
it('발행 상태라도 과거 마감일이면 폼을 노출하지 않는다', async () => {
  jest.mocked(prisma.hiringPosting.findUnique).mockResolvedValue({
    status: 'ACTIVE',
    closingDate: new Date('2023-11-30'),
    title: '과거 공고',
    positions: [],
    stores: [],
    applicationEntries: [],
  } as never)
  render(await Page(props))
  expect(
    screen.getByRole('heading', { name: '현재 지원할 수 없는 공고입니다' })
  ).toBeInTheDocument()
  expect(screen.queryByRole('form')).not.toBeInTheDocument()
})
it('발행된 상시 모집 공고는 정상 지원서를 표시한다', async () => {
  jest.mocked(prisma.hiringPosting.findUnique).mockResolvedValue({
    status: 'ACTIVE',
    closingDate: null,
    title: '채용',
    positions: [],
    stores: [],
    applicationEntries: [],
  } as never)
  render(await Page(props))
  expect(screen.getByRole('form', { name: '지원서' })).toBeInTheDocument()
})
