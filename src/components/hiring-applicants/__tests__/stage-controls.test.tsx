import { Suspense, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { StageControls } from '../stage-controls'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
beforeEach(() => jest.clearAllMocks())

it('저장 후 서버 재조회가 끝날 때까지 상태 변경을 잠근다', async () => {
  let ready = false
  let finish!: () => void
  const wait = new Promise<void>((resolve) => {
    finish = () => {
      ready = true
      resolve()
    }
  })
  function Harness() {
    const [updated, setUpdated] = useState(false)
    refresh.mockImplementation(() => setUpdated(true))
    if (updated && !ready) throw wait
    return (
      <StageControls
        applicationId="qa"
        stage={updated ? 'ACCEPTED' : 'HIRING'}
        hiringStage="APPLIED"
      />
    )
  }
  global.fetch = jest.fn().mockResolvedValue({ ok: true })
  render(
    <Suspense fallback={<div>불러오는 중</div>}>
      <Harness />
    </Suspense>
  )
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '합격' })))
  expect(screen.getByRole('button', { name: '불합격' })).toBeDisabled()
  await act(async () => finish())
  expect(screen.getByRole('button', { name: '합격' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '불합격' })).toBeEnabled()
})

it('실패하면 기존 상태를 유지하고 다시 변경할 수 있다', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('연결 실패'))
  render(<StageControls applicationId="qa" stage="HIRING" hiringStage="APPLIED" />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '면접' })))
  expect(toast.error).toHaveBeenCalledWith('연결 실패')
  expect(screen.getByRole('button', { name: '서류 접수' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '면접' })).toBeEnabled()
  expect(refresh).not.toHaveBeenCalled()
})
