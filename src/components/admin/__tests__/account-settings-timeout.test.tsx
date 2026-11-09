import { act, fireEvent, render, screen } from '@testing-library/react'
import { AccountSettings } from '../account-settings'
import { AccountSettingsForm } from '@/components/settings/account-settings-form'

const auth = {
  updateUser: jest.fn(),
  mfa: {
    listFactors: jest.fn(),
    unenroll: jest.fn(),
    enroll: jest.fn(),
    challengeAndVerify: jest.fn(),
  },
}
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
// 브라우저 Supabase 클라이언트는 싱글턴이다 — 매번 새 객체면 MfaSection 의 effect 가 반복 실행된다
const client = { auth }
jest.mock('@/lib/supabase/client', () => ({ createClient: () => client }))
jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { email: 'a@b.c' } }) }))

const hang = () => new Promise(() => {})
const { toast } = jest.requireMock('sonner')

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
})
afterEach(() => jest.useRealTimers())

async function wait(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms)
  })
}

test('어드민 — MFA 상태 조회가 무응답이면 「불러오는 중」을 풀고 지연 안내', async () => {
  auth.mfa.listFactors.mockReturnValue(hang())
  render(<AccountSettings email="op@workdeck.work" />)
  await wait(20_000)
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/응답이 지연/))
  expect(screen.queryByText('불러오는 중...')).not.toBeInTheDocument()
})

test('어드민 — 비밀번호 변경이 무응답이면 로딩을 풀고 지연 안내', async () => {
  auth.mfa.listFactors.mockResolvedValue({ data: { all: [] }, error: null })
  auth.updateUser.mockReturnValue(hang())
  const { container } = render(<AccountSettings email="op@workdeck.work" />)
  await wait(0)
  for (const input of container.querySelectorAll('form input[type="password"]')) {
    fireEvent.change(input, { target: { value: 'Password1!' } })
  }
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 변경' }))
  })
  await wait(20_000)
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/응답이 지연/))
  expect(screen.getByRole('button', { name: '비밀번호 변경' })).toBeEnabled()
})

test('계정 설정 — 비밀번호 변경이 무응답이면 로딩을 풀고 지연 안내', async () => {
  auth.updateUser.mockReturnValue(hang())
  render(<AccountSettingsForm />)
  fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: 'Password1!' } })
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'Password1!' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 변경' }))
  })
  await wait(20_000)
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/응답이 지연/))
  expect(screen.getByRole('button', { name: '비밀번호 변경' })).toBeEnabled()
})
