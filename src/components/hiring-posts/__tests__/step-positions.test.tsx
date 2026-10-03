import { act, fireEvent, render, screen } from '@testing-library/react'
import { StepPositions } from '../step-positions'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

it('직무 저장 중 닫기를 막고 실패 시 입력을 유지한다', async () => {
  let finish!: (value: unknown) => void
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  ) as jest.Mock
  render(<StepPositions postingId="qa" positions={[]} spacePositions={[]} onChange={jest.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '직무 추가' }))
  fireEvent.change(screen.getByPlaceholderText('예: 홀 서빙'), { target: { value: 'QA 직무' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await act(async () => {
    finish({ ok: false })
  })
  expect(screen.getByPlaceholderText('예: 홀 서빙')).toHaveValue('QA 직무')
})

it('직무 생성 응답을 반영하고 실패할 수 있는 추가 목록 조회를 보내지 않는다', async () => {
  const position = { id: 'new-position', name: 'QA 직무' }
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ position }) })
    .mockResolvedValue({ ok: false })
  const onChange = jest.fn()
  render(<StepPositions postingId="qa" positions={[]} spacePositions={[]} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: '직무 추가' }))
  fireEvent.change(screen.getByPlaceholderText('예: 홀 서빙'), { target: { value: 'QA 직무' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
  })
  expect(onChange).toHaveBeenCalledWith([position])
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
