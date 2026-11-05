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
}))

const posting = {
  status: 'DRAFT',
  spaceId: 's',
  closingDate: null,
  positions: [],
  stores: [],
  contents: [
    {
      id: 'button',
      spaceId: 's',
      contentType: 'button',
      data: { title: '지원하기', linkType: 'form' },
    },
    {
      id: 'image',
      spaceId: 's',
      contentType: 'image',
      imagePath: 'qa.png',
      data: { link: { linkType: 'form' } },
    },
  ],
}
const props = {
  params: Promise.resolve({ uuid: 'qa' }),
  searchParams: Promise.resolve({ preview: '1' }),
}
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getUser).mockResolvedValue({ id: 'user' } as never)
  jest.mocked(prisma.spaceMember.findFirst).mockResolvedValue({ id: 'member' } as never)
})

it('초안 미리보기의 지원 버튼과 이미지에서 지원서 미리보기로 이동한다', async () => {
  jest.mocked(prisma.hiringPosting.findUnique).mockResolvedValue(posting as never)
  render(await Page(props))
  expect(screen.getByRole('link', { name: '지원하기' })).toHaveAttribute(
    'href',
    '/p/qa/apply?preview=1'
  )
  expect(screen.getByRole('img', { name: '공고 상세' }).closest('a')).toHaveAttribute(
    'href',
    '/p/qa/apply?preview=1'
  )
})

it('발행 공고의 지원 링크는 일반 지원서 주소를 유지한다', async () => {
  jest
    .mocked(prisma.hiringPosting.findUnique)
    .mockResolvedValue({ ...posting, status: 'ACTIVE' } as never)
  render(await Page(props))
  expect(screen.getByRole('link', { name: '지원하기' })).toHaveAttribute('href', '/p/qa/apply')
  expect(screen.getByRole('img', { name: '공고 상세' }).closest('a')).toHaveAttribute(
    'href',
    '/p/qa/apply'
  )
})

it('공간 구성원이 아니면 초안 미리보기를 볼 수 없다', async () => {
  jest.mocked(prisma.hiringPosting.findUnique).mockResolvedValue(posting as never)
  jest.mocked(prisma.spaceMember.findFirst).mockResolvedValue(null)
  await expect(Page(props)).rejects.toThrow('404')
})
