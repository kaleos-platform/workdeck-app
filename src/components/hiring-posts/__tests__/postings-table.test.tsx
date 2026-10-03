import { fireEvent, render, screen } from '@testing-library/react'
import { PostingsTable } from '../postings-table'
const push = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const props = {
  postings: [],
  total: 501,
  page: 11,
  pageSize: 50,
  q: '강남',
  status: 'DRAFT' as const,
}
beforeEach(() => jest.clearAllMocks())

it('페이지 이동에서 확정 검색·상태를 유지하고 검색 제출은 첫 페이지로 이동한다', () => {
  render(<PostingsTable {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '이전' }))
  expect(push).toHaveBeenLastCalledWith(
    '/d/recruiting/postings?q=%EA%B0%95%EB%82%A8&status=DRAFT&page=10'
  )
  expect(screen.getByRole('button', { name: '다음' })).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox', { name: '공고 제목 검색' }), {
    target: { value: '  주말  ' },
  })
  fireEvent.submit(screen.getByRole('search'))
  expect(push).toHaveBeenLastCalledWith('/d/recruiting/postings?q=%EC%A3%BC%EB%A7%90&status=DRAFT')
})

it('범위를 벗어난 빈 페이지에서는 필터를 유지한 첫 페이지 복구를 제공한다', () => {
  render(<PostingsTable {...props} page={12} />)
  fireEvent.click(screen.getByRole('button', { name: '첫 페이지로' }))
  expect(push).toHaveBeenLastCalledWith('/d/recruiting/postings?q=%EA%B0%95%EB%82%A8&status=DRAFT')
})

it('상태 변경은 확정 검색어를 보존하고 입력 중인 검색어와 이전 page를 사용하지 않는다', () => {
  render(<PostingsTable {...props} />)
  fireEvent.change(screen.getByRole('textbox', { name: '공고 제목 검색' }), {
    target: { value: '미제출' },
  })
  fireEvent.keyDown(screen.getByRole('tab', { name: '전체' }), { key: 'Enter' })
  expect(push).toHaveBeenLastCalledWith('/d/recruiting/postings?q=%EA%B0%95%EB%82%A8')
  fireEvent.click(screen.getByRole('button', { name: '초기화' }))
  expect(push).toHaveBeenLastCalledWith('/d/recruiting/postings')
})
