import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoPanel } from '../memo-panel'

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))
const c = (id: string, content: string) => ({
  id,
  userId: 'u',
  content,
  createdAt: '2026-11-10T00:00:00.000Z',
  editedAt: null,
})
const props = { applicationId: 'a', currentUserId: 'u' }

it('모바일 요약에 개수(이전 메모 포함)와 최근 메모를 보여준다', () => {
  render(<MemoPanel {...props} initial={[c('1', '첫 메모'), c('2', '두번째')]} legacyMemo="이관" />)
  expect(screen.getByRole('button', { name: /메모 3 · 최근: 두번째/ })).toBeInTheDocument()
})

it('메모가 없으면 메모 남기기를 보여준다', () => {
  render(<MemoPanel {...props} initial={[]} legacyMemo={null} />)
  expect(screen.getByRole('button', { name: '메모 남기기' })).toBeInTheDocument()
})

it('요약을 누르면 전체 스레드가 시트로 열린다', async () => {
  render(<MemoPanel {...props} initial={[c('1', '첫 메모')]} legacyMemo={null} />)
  await userEvent.click(screen.getByRole('button', { name: /메모 1/ }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getAllByText('첫 메모').length).toBeGreaterThan(1)
})
