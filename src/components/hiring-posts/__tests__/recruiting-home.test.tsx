import { render, screen, within } from '@testing-library/react'
import RecruitingHomePage from '../../../../app/d/recruiting/home/page'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext } from '@/lib/api-helpers'

jest.mock('@/lib/prisma', () => ({ prisma: { hiringPosting: { findMany: jest.fn() } } }))
jest.mock('@/lib/api-helpers', () => ({ resolveDeckContext: jest.fn() }))
jest.mock('next/navigation', () => ({
  redirect: jest.fn(() => {
    throw new Error('redirect')
  }),
}))
jest.mock('../new-posting-button', () => ({ NewPostingButton: () => <button>새 공고</button> }))

beforeEach(() => {
  jest.clearAllMocks()
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 'space-qa' } })
})

it('현재 공간의 최근 생성 공고 5건만 조회하고 편집·HTML·템플릿 진입을 제공한다', async () => {
  ;(prisma.hiringPosting.findMany as jest.Mock).mockResolvedValue([
    {
      id: 'qa-post',
      title: 'QA 최근 공고',
      status: 'DRAFT',
      createdAt: new Date('2026-09-27T00:00:00Z'),
    },
  ])
  render(await RecruitingHomePage())
  expect(prisma.hiringPosting.findMany).toHaveBeenCalledWith({
    where: { spaceId: 'space-qa', status: { not: 'ARCHIVED' } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 5,
    select: { id: true, title: true, status: true, createdAt: true },
  })
  const row = screen.getByText('QA 최근 공고').closest('li')!
  expect(within(row).getByRole('link', { name: '편집' })).toHaveAttribute(
    'href',
    '/d/recruiting/postings/qa-post/build'
  )
  expect(within(row).getByRole('link', { name: 'HTML 확인' })).toHaveAttribute(
    'href',
    '/d/recruiting/postings/qa-post'
  )
  expect(screen.getByRole('link', { name: '상세 템플릿 관리' })).toHaveAttribute(
    'href',
    '/d/recruiting/templates'
  )
})

it('빈 공간에서 첫 공고 안내와 생성 버튼을 제공한다', async () => {
  ;(prisma.hiringPosting.findMany as jest.Mock).mockResolvedValue([])
  render(await RecruitingHomePage())
  expect(
    screen.getByText('표시할 공고가 없습니다. 새 공고를 만들거나 전체 공고를 확인하세요.')
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '새 공고' })).toBeInTheDocument()
})

it('공간 접근이 거부되면 공고를 조회하지 않는다', async () => {
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ error: {} })
  await expect(RecruitingHomePage()).rejects.toThrow('redirect')
  expect(prisma.hiringPosting.findMany).not.toHaveBeenCalled()
})
