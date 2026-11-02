import { render, screen, within } from '@testing-library/react'
import PostingsPage from '../page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  redirect: jest.fn(),
}))
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: async () => ({ space: { id: 'qa' } }),
}))
jest.mock('@/lib/coupang-ads/server-timing', () => ({
  collectServerTimings: async (fn: () => unknown) => ({ result: await fn(), timings: {} }),
}))
jest.mock('@/lib/hiring/posting-list', () => ({
  listPostingPage: async () => ({
    rows: [
      {
        id: 'a',
        uuid: 'a',
        title: '지난 발행 공고',
        status: 'ACTIVE',
        closingDate: new Date('2026-11-01T00:00:00Z'),
        createdAt: new Date('2026-10-01T00:00:00Z'),
        _count: { applications: 0 },
      },
      {
        id: 'b',
        uuid: 'b',
        title: '오늘 마감 공고',
        status: 'ACTIVE',
        closingDate: new Date('2026-11-02T00:00:00Z'),
        createdAt: new Date('2026-10-01T00:00:00Z'),
        _count: { applications: 0 },
      },
      {
        id: 'c',
        uuid: 'c',
        title: '마감일 지난 초안',
        status: 'DRAFT',
        closingDate: new Date('2026-11-01T00:00:00Z'),
        createdAt: new Date('2026-10-01T00:00:00Z'),
        _count: { applications: 0 },
      },
      {
        id: 'd',
        uuid: 'd',
        title: '상시 모집 공고',
        status: 'ACTIVE',
        closingDate: null,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        _count: { applications: 0 },
      },
      {
        id: 'e',
        uuid: 'e',
        title: '직접 마감 공고',
        status: 'CLOSED',
        closingDate: new Date('2026-11-01T00:00:00Z'),
        createdAt: new Date('2026-10-01T00:00:00Z'),
        _count: { applications: 0 },
      },
    ],
    total: 5,
    page: 1,
    pageSize: 50,
    q: '',
    status: 'ALL',
    store: '',
    position: '',
    jobType: '',
  }),
}))

afterEach(() => jest.useRealTimers())

it('발행된 공고만 한국 마감일이 지난 뒤 접수 마감을 표시한다', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-02T14:59:59Z'))
  const result = render(await PostingsPage({ searchParams: Promise.resolve({}) }))
  const row = (title: string) => within(screen.getByText(title).closest('tr')!)
  expect(row('지난 발행 공고').getByText('발행됨')).toBeInTheDocument()
  expect(row('지난 발행 공고').getByText('접수 마감')).toBeInTheDocument()
  expect(row('오늘 마감 공고').queryByText('접수 마감')).not.toBeInTheDocument()
  expect(row('마감일 지난 초안').queryByText('접수 마감')).not.toBeInTheDocument()
  expect(row('상시 모집 공고').queryByText('접수 마감')).not.toBeInTheDocument()
  expect(row('직접 마감 공고').getByText('마감')).toBeInTheDocument()
  expect(row('직접 마감 공고').queryByText('접수 마감')).not.toBeInTheDocument()
  jest.setSystemTime(new Date('2026-11-02T15:00:00Z'))
  result.rerender(await PostingsPage({ searchParams: Promise.resolve({}) }))
  expect(row('오늘 마감 공고').getByText('접수 마감')).toBeInTheDocument()
})
