import { act, fireEvent, render, screen } from '@testing-library/react'
import { TemplatesManager } from '../templates-manager'
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
const rows = [
  { id: 'qa', name: '원본 템플릿', blockCount: 5, updatedAt: '2026-09-27', isSample: false },
]
beforeEach(() => {
  jest.clearAllMocks()
  window.confirm = jest.fn(() => true)
})

it('이름 변경 중 입력·취소를 잠그고 성공 응답을 추가 목록 GET 없이 반영한다', async () => {
  let finish!: (value: unknown) => void
  global.fetch = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    .mockRejectedValue(new Error('목록 조회 실패'))
  render(<TemplatesManager initialTemplates={rows} />)
  fireEvent.click(screen.getByRole('button', { name: '원본 템플릿 이름 변경' }))
  fireEvent.change(screen.getByRole('textbox', { name: '템플릿 이름' }), {
    target: { value: '새 이름' },
  })
  fireEvent.click(screen.getByRole('button', { name: '이름 저장' }))
  expect(screen.getByRole('textbox', { name: '템플릿 이름' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '이름 변경 취소' })).toBeDisabled()
  await act(async () =>
    finish({
      ok: true,
      json: async () => ({ template: { id: 'qa', name: '새 이름', updatedAt: '2026-09-28' } }),
    })
  )
  expect(screen.getByText('새 이름')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('삭제 성공은 추가 조회 없이 목록에서 제거한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: true })
    .mockRejectedValue(new Error('목록 조회 실패'))
  render(<TemplatesManager initialTemplates={rows} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '원본 템플릿 삭제' })))
  expect(screen.queryByText('원본 템플릿')).not.toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('이름 저장 실패는 입력을 유지하고 재시도를 허용한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ template: { id: 'qa', name: '재시도', updatedAt: '2026-09-28' } }),
    })
  render(<TemplatesManager initialTemplates={rows} />)
  fireEvent.click(screen.getByRole('button', { name: '원본 템플릿 이름 변경' }))
  fireEvent.change(screen.getByRole('textbox', { name: '템플릿 이름' }), {
    target: { value: '재시도' },
  })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '이름 저장' })))
  expect(screen.getByRole('textbox', { name: '템플릿 이름' })).toHaveValue('재시도')
  expect(screen.getByRole('button', { name: '이름 저장' })).toBeEnabled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '이름 저장' })))
  expect(screen.getByText('재시도')).toBeInTheDocument()
})

it('삭제 실패는 목록을 유지하고 다시 삭제할 수 있다', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true })
  render(<TemplatesManager initialTemplates={rows} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '원본 템플릿 삭제' })))
  expect(screen.getByText('원본 템플릿')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '원본 템플릿 삭제' })).toBeEnabled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '원본 템플릿 삭제' })))
  expect(screen.queryByText('원본 템플릿')).not.toBeInTheDocument()
})
