import { fireEvent, render, screen } from '@testing-library/react'
import PostingsPage from '../page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  redirect: jest.fn(),
}))
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(async () => ({ space: { id: 'qa' } })),
}))
jest.mock('@/lib/coupang-ads/server-timing', () => ({
  collectServerTimings: async (fn: () => unknown) => ({ result: await fn(), timings: {} }),
}))
jest.mock('@/lib/hiring/posting-list', () => ({
  listPostingPage: async (
    _space: string,
    params: { status?: string; page?: string; q?: string }
  ) => ({
    rows: [],
    total: 100,
    page: Number(params.page ?? 1),
    pageSize: 50,
    q: params.q ?? '',
    status: params.status ?? 'ALL',
    store: '',
    position: '',
    jobType: '',
  }),
}))

it('상태 또는 페이지를 바꿔도 검색 전에 입력한 제목과 장소를 유지한다', async () => {
  const result = render(await PostingsPage({ searchParams: Promise.resolve({}) }))
  fireEvent.change(screen.getByLabelText('공고 제목 검색'), { target: { value: '입력 중 제목' } })
  fireEvent.change(screen.getByLabelText('모집 장소'), { target: { value: '입력 중 장소' } })
  result.rerender(await PostingsPage({ searchParams: Promise.resolve({ status: 'DRAFT' }) }))
  expect(screen.getByLabelText('공고 제목 검색')).toHaveValue('입력 중 제목')
  expect(screen.getByLabelText('모집 장소')).toHaveValue('입력 중 장소')
  result.rerender(
    await PostingsPage({ searchParams: Promise.resolve({ status: 'DRAFT', page: '2' }) })
  )
  expect(screen.getByLabelText('공고 제목 검색')).toHaveValue('입력 중 제목')
  expect(screen.getByLabelText('모집 장소')).toHaveValue('입력 중 장소')
  result.rerender(await PostingsPage({ searchParams: Promise.resolve({ q: '확정 검색' }) }))
  expect(screen.getByLabelText('공고 제목 검색')).toHaveValue('확정 검색')
})
