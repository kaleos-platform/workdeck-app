import { act, fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { StageChangeDialog } from '../stage-change-dialog'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
beforeEach(() => jest.clearAllMocks())

function setup(onOpenChange = jest.fn()) {
  render(
    <StageChangeDialog
      applicationId="app-1"
      stage="HIRING"
      hiringStage="APPLIED"
      open
      onOpenChange={onOpenChange}
    />
  )
  return onOpenChange
}

it('현재 값이 선택돼 있고 바뀐 게 없으면 변경 버튼이 비활성이다', () => {
  setup()
  expect(screen.getByRole('button', { name: '서류 접수' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '진행 중' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '변경' })).toBeDisabled()
})

it('두 값을 바꾸면 stage·hiringStage 를 한 번의 PATCH 로 보내고 새로고침한다', async () => {
  const onOpenChange = setup()
  global.fetch = jest.fn().mockResolvedValue({ ok: true })
  fireEvent.click(screen.getByRole('button', { name: '면접' }))
  fireEvent.click(screen.getByRole('button', { name: '합격' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '변경' })))
  expect(global.fetch).toHaveBeenCalledTimes(1)
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toBe('/api/hiring-applicants/applications/app-1')
  expect(init.method).toBe('PATCH')
  expect(JSON.parse(init.body)).toEqual({ stage: 'ACCEPTED', hiringStage: 'INTERVIEW' })
  expect(refresh).toHaveBeenCalled()
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it('불합격을 고르면 확인 문구를 보여준다', () => {
  setup()
  expect(screen.queryByText(/불합격으로 변경합니다/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '불합격' }))
  expect(screen.getByText(/불합격으로 변경합니다/)).toBeInTheDocument()
})

it('실패하면 오류를 보이고 다시 시도할 수 있다', async () => {
  setup()
  global.fetch = jest
    .fn()
    .mockRejectedValueOnce(new Error('연결 실패'))
    .mockResolvedValueOnce({ ok: true })
  fireEvent.click(screen.getByRole('button', { name: '면접' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '변경' })))
  expect(toast.error).toHaveBeenCalledWith('연결 실패')
  expect(refresh).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '변경' })).toBeEnabled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '변경' })))
  expect(refresh).toHaveBeenCalledTimes(1)
})
