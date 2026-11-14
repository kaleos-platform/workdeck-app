import { render, screen } from '@testing-library/react'
import RecruitingHomePage from '../../../../app/d/recruiting/home/page'
import { resolveDeckContext } from '@/lib/api-helpers'
import { getRecruitingHomeSummary } from '@/lib/hiring/home-summary'

jest.mock('@/lib/api-helpers', () => ({ resolveDeckContext: jest.fn() }))
jest.mock('@/lib/hiring/home-summary', () => ({
  formatDday: () => null,
  getRecruitingHomeSummary: jest.fn(),
}))
jest.mock('next/navigation', () => ({
  redirect: jest.fn(() => {
    throw new Error('redirect')
  }),
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('../new-posting-button', () => ({ NewPostingButton: () => <button>새 공고</button> }))

const EMPTY_COUNTS = { all: 0, APPLIED: 0, INTERVIEW: 0, JOB_OFFER: 0, ACCEPTED: 0, REJECTED: 0 }

beforeEach(() => {
  jest.clearAllMocks()
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 'space-qa' } })
})

it('빈 공간에서 안내 문구와 새 공고 버튼을 제공하고 현재 공간으로만 조회한다', async () => {
  ;(getRecruitingHomeSummary as jest.Mock).mockResolvedValue({
    counts: EMPTY_COUNTS,
    weekCount: 0,
    weekFrom: '2026-11-07',
    postings: [],
    recent: [],
  })
  render(await RecruitingHomePage())
  expect(getRecruitingHomeSummary).toHaveBeenCalledWith('space-qa')
  expect(screen.getByText(/모집 중인 공고가 없습니다/)).toBeInTheDocument()
  expect(screen.getByText('공고를 발행하면 지원서가 이곳에 쌓입니다.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '새 공고' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '상세 템플릿 관리' })).toHaveAttribute(
    'href',
    '/d/recruiting/templates'
  )
})

it('공간 접근이 거부되면 요약을 조회하지 않는다', async () => {
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ error: {} })
  await expect(RecruitingHomePage()).rejects.toThrow('redirect')
  expect(getRecruitingHomeSummary).not.toHaveBeenCalled()
})
