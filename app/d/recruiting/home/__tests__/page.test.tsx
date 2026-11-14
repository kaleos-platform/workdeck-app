import { render, screen } from '@testing-library/react'
import RecruitingHomePage from '../page'

jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: async () => ({ space: { id: 'qa' } }),
}))
jest.mock('@/components/hiring-posts/new-posting-button', () => ({
  NewPostingButton: () => <button>새 공고</button>,
}))
jest.mock('@/lib/hiring/home-summary', () => ({
  formatDday: () => 'D-3',
  getRecruitingHomeSummary: async () => ({
    counts: { all: 9, APPLIED: 5, INTERVIEW: 3, JOB_OFFER: 1, ACCEPTED: 0, REJECTED: 0 },
    weekCount: 4,
    weekFrom: '2026-11-07',
    postings: [
      {
        id: 'p1',
        uuid: 'u1',
        title: '홀 직원',
        closingDate: new Date('2026-11-17T00:00:00Z'),
        inProgress: 2,
      },
    ],
    recent: [
      {
        id: 'a1',
        maskedName: '합*1',
        stage: 'HIRING',
        hiringStage: 'INTERVIEW',
        createdAt: new Date('2026-11-13T00:00:00Z'),
        posting: { title: '홀 직원' },
      },
    ],
  }),
}))

it('요약 링크·공고·최근 지원자를 렌더한다', async () => {
  render(await RecruitingHomePage())
  expect(screen.getByRole('link', { name: /^면접/ })).toHaveAttribute(
    'href',
    '/d/recruiting/applications?stage=HIRING&process=INTERVIEW'
  )
  expect(screen.getByRole('link', { name: /^최근 7일/ })).toHaveAttribute(
    'href',
    '/d/recruiting/applications?from=2026-11-07'
  )
  expect(screen.getByText('진행 중 지원자 2명')).toBeInTheDocument()
  expect(screen.getByText('합*1')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /지원서 링크 복사/ })).toBeInTheDocument()
})
