import PostingsPage from '../../../../app/d/recruiting/postings/page'
import { resolveDeckContext } from '@/lib/api-helpers'
import { listPostingPage } from '@/lib/hiring/posting-list'

jest.mock('@/lib/api-helpers', () => ({ resolveDeckContext: jest.fn() }))
jest.mock('@/lib/hiring/posting-list', () => ({ listPostingPage: jest.fn() }))
jest.mock('@/components/hiring-posts/postings-table', () => ({ PostingsTable: () => null }))

beforeEach(() => {
  jest.clearAllMocks()
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 'synthetic-private-id' } })
  ;(listPostingPage as jest.Mock).mockResolvedValue({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 50,
    q: '',
    status: 'ALL',
  })
})
afterEach(() => jest.restoreAllMocks())
it('느린 요청은 개인정보 없이 인증과 목록 조회 시간만 기록한다', async () => {
  jest
    .spyOn(performance, 'now')
    .mockReturnValueOnce(100)
    .mockReturnValueOnce(500)
    .mockReturnValueOnce(850)
  const log = jest.spyOn(console, 'info').mockImplementation(() => {})
  await PostingsPage({ searchParams: Promise.resolve({}) })
  expect(log).toHaveBeenCalledWith('[recruiting:postings:slow]', { contextMs: 400, queryMs: 350 })
})
it('빠른 요청은 로그를 남기지 않는다', async () => {
  jest
    .spyOn(performance, 'now')
    .mockReturnValueOnce(100)
    .mockReturnValueOnce(150)
    .mockReturnValueOnce(200)
  const log = jest.spyOn(console, 'info').mockImplementation(() => {})
  await PostingsPage({ searchParams: Promise.resolve({}) })
  expect(log).not.toHaveBeenCalled()
})
