import { act, fireEvent, render, screen } from '@testing-library/react'
import { CommentThread } from '../comment-thread'

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))
const comment = {
  id: 'c1',
  userId: 'qa',
  content: '기존 메모',
  createdAt: '2026-09-27',
  editedAt: null,
}
const props = { applicationId: 'app-qa', currentUserId: 'qa', initial: [comment] }

it('추가 중 입력·편집·삭제를 잠그고 성공 응답을 반영한다', async () => {
  let finish!: (v: unknown) => void
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  ) as jest.Mock
  render(<CommentThread {...props} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '새 메모' } })
  fireEvent.click(screen.getByRole('button', { name: '코멘트 추가' }))
  expect(screen.getByRole('textbox')).toBeDisabled()
  expect(screen.getByRole('button', { name: '수정' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '삭제' })).toBeDisabled()
  await act(async () =>
    finish({
      ok: true,
      json: async () => ({ comment: { ...comment, id: 'c2', content: '새 메모' } }),
    })
  )
  expect(screen.getByText('새 메모')).toBeInTheDocument()
  expect(screen.getByRole('textbox')).toHaveValue('')
})

it('수정 중 취소·다른 편집을 막고 실패한 입력을 유지한다', async () => {
  let finish!: (v: unknown) => void
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  ) as jest.Mock
  render(
    <CommentThread {...props} initial={[comment, { ...comment, id: 'c2', content: '다른 메모' }]} />
  )
  fireEvent.click(screen.getAllByRole('button', { name: '수정' })[0])
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '수정한 메모' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(screen.getByRole('button', { name: '취소' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '수정' })).toBeDisabled()
  await act(async () => finish({ ok: false }))
  expect(screen.getAllByRole('textbox')[0]).toHaveValue('수정한 메모')
  expect(screen.getByRole('button', { name: '저장' })).toBeEnabled()
})

it('삭제 실패는 코멘트를 유지하고 재시도 성공 시 제거한다', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true })
  render(<CommentThread {...props} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '삭제' })))
  expect(screen.getByText('기존 메모')).toBeInTheDocument()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '삭제' })))
  expect(screen.queryByText('기존 메모')).not.toBeInTheDocument()
})
