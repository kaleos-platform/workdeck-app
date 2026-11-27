import { render, screen } from '@testing-library/react'
import { FeedbackTable, type FeedbackRow } from '../feedback-table'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

const row: FeedbackRow = {
  id: 'fb-1',
  createdAt: '2026-11-27T05:00:00Z',
  type: 'BUG',
  status: 'NEW',
  body: '재고 현황에서 엑셀 업로드하면 멈춰요',
  email: 'qa@example.com',
  spaceName: '크림드',
  attachmentCount: 2,
}
const summary = { counts: { NEW: 4, IN_PROGRESS: 2, DONE: 11, ON_HOLD: 3 }, totalBytes: 38.24 * 1048576, capBytes: 500 * 1048576 }
const base = { rows: [row], summary, type: '', status: '', page: 1, pageCount: 1 }

it('모바일 카드는 상세 링크이고 날짜·제출자·첨부 수를 보여준다', () => {
  const { container } = render(<FeedbackTable {...base} />)
  const card = container.querySelector('.md\\:hidden a[href="/admin/feedback/fb-1"]')
  expect(card).not.toBeNull()
  expect(card).toHaveTextContent('qa@example.com')
  expect(card).toHaveTextContent('첨부 2')
})

it('첨부는 개수만 표시하고 이미지를 로드하지 않는다', () => {
  const { container } = render(<FeedbackTable {...base} />)
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('table')).toHaveTextContent('2')
})

it('상태별 건수와 총 용량(MB 소수 1자리)을 요약한다', () => {
  render(<FeedbackTable {...base} />)
  expect(screen.getByText(/접수 4/)).toBeInTheDocument()
  expect(screen.getByText(/확인 중 2/)).toBeInTheDocument()
  expect(screen.getByText(/완료 11/)).toBeInTheDocument()
  expect(screen.getByText(/보류 3/)).toBeInTheDocument()
  expect(screen.getByText(/38\.2MB \/ 500MB/)).toBeInTheDocument()
})

it('행은 상세 링크이고 화면 경로는 링크가 아니다', () => {
  render(<FeedbackTable {...base} />)
  expect(screen.getAllByRole('link', { name: /재고 현황에서/ })[0]).toHaveAttribute('href', '/admin/feedback/fb-1')
})

it('필터 값이 선택기에 반영되고 페이지 링크가 필터를 유지한다', () => {
  render(<FeedbackTable {...base} type="BUG" status="IN_PROGRESS" page={2} pageCount={3} />)
  expect(screen.getByRole('combobox', { name: '유형 필터' })).toHaveTextContent('서비스 오류')
  expect(screen.getByRole('combobox', { name: '상태 필터' })).toHaveTextContent('확인 중')
  expect(screen.getByRole('link', { name: '이전' })).toHaveAttribute('href', '/admin/feedback?type=BUG&status=IN_PROGRESS')
  expect(screen.getByRole('link', { name: '다음' })).toHaveAttribute('href', '/admin/feedback?type=BUG&status=IN_PROGRESS&page=3')
})
