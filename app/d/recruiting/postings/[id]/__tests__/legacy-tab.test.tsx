import { render, screen } from '@testing-library/react'
import PostingDetailPage from '../page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
  redirect: jest.fn(),
  notFound: jest.fn(),
}))
jest.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'localhost:3000' }) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(async () => ({ role: 'OWNER', space: { id: 'qa' } })),
}))
jest.mock('@/lib/hiring/postings', () => ({
  getPostingDetail: jest.fn(async () => ({
    id: 'p1',
    uuid: 'u1',
    title: '합성 공고',
    status: 'DRAFT',
    publishedAt: null,
    closingDate: null,
    contents: [],
    positions: [],
  })),
}))
jest.mock('@/lib/hiring/applications', () => ({
  countApplicationsByStatus: jest.fn(async () => ({ all: 3 })),
}))
jest.mock('@/components/hiring-applicants/applications-list-section', () => ({
  ApplicationsListSection: () => <p>지원자 목록 자리</p>,
}))

const render_ = async (tab?: string) =>
  render(
    await PostingDetailPage({
      params: Promise.resolve({ id: 'p1' }),
      searchParams: Promise.resolve(tab ? { tab } : {}),
    })
  )

it.each([undefined, 'recruit', 'content', 'unknown'])(
  'tab=%s 는 공고 상세(미리보기 포함)로 열린다',
  async (tab) => {
    await render_(tab)
    expect(screen.getByRole('link', { name: '공고 상세' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTitle('외부 게시용 공고 미리보기')).toBeInTheDocument()
    expect(screen.queryByText('지원자 목록 자리')).not.toBeInTheDocument()
  }
)

it('tab=applicants 는 지원자 탭이다', async () => {
  await render_('applicants')
  expect(screen.getByText('지원자 목록 자리')).toBeInTheDocument()
  expect(screen.queryByTitle('외부 게시용 공고 미리보기')).not.toBeInTheDocument()
})
