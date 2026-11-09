import { act, fireEvent, render, screen } from '@testing-library/react'
import { LoginForm } from '../login-form'
import { ForgotPasswordForm } from '../forgot-password-form'
import { ResetPasswordForm } from '../reset-password-form'
import { MfaStepUp } from '../mfa-step-up'
import { InviteAccept } from '@/components/invite/invite-accept'
import { withAuthTimeout } from '@/lib/auth/auth-timeout'

const auth = {
  signInWithPassword: jest.fn(),
  resetPasswordForEmail: jest.fn(),
  updateUser: jest.fn(),
  signOut: jest.fn(),
  mfa: { listFactors: jest.fn(), challengeAndVerify: jest.fn(), enroll: jest.fn() },
}
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }))

const hang = () => new Promise(() => {})
const { toast } = jest.requireMock('sonner')

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
})
afterEach(() => jest.useRealTimers())

async function click(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}
async function wait(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms)
  })
}

test('withAuthTimeout — 요청이 예외를 던져도(잠금 시간 초과 등) null 로 끝난다', async () => {
  await expect(withAuthTimeout(Promise.reject(new Error('lock timeout')))).resolves.toBeNull()
})

test('로그인 성공 뒤 15초 안에 화면이 안 바뀌면 로딩을 풀고 바로가기 링크를 보여준다', async () => {
  auth.signInWithPassword.mockResolvedValue({ data: {}, error: null })
  render(<LoginForm redirectTo="/d/sales-content" />)
  fireEvent.change(screen.getByPlaceholderText('name@example.com'), {
    target: { value: 'user@example.com' },
  })
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password1' } })
  await click('로그인')
  expect(screen.getByRole('button', { name: '로그인 중...' })).toBeDisabled()

  await wait(15_000)

  expect(screen.getByText(/이동이 지연/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /바로 이동/ })).toHaveAttribute(
    'href',
    '/d/sales-content'
  )
  expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled()
})

test('비밀번호 찾기 — 인증 서버 무응답이면 로딩을 풀고 지연 안내', async () => {
  auth.resetPasswordForEmail.mockReturnValue(hang())
  render(<ForgotPasswordForm />)
  fireEvent.change(screen.getByPlaceholderText('name@example.com'), {
    target: { value: 'user@example.com' },
  })
  await click('비밀번호 재설정 링크 보내기')
  await wait(20_000)
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/응답이 지연/))
  expect(screen.getByRole('button', { name: '비밀번호 재설정 링크 보내기' })).toBeEnabled()
})

test('비밀번호 변경 — 서버 일시 오류는 「링크 만료」가 아니라 지연 안내', async () => {
  auth.updateUser.mockResolvedValue({
    data: {},
    error: { name: 'AuthRetryableFetchError', status: 503, message: 'x' },
  })
  const { container } = render(<ResetPasswordForm />)
  for (const input of container.querySelectorAll('input[type="password"]')) {
    fireEvent.change(input, { target: { value: 'Password1!' } })
  }
  await click('비밀번호 변경')
  expect(screen.getByText(/응답이 지연/)).toBeInTheDocument()
  expect(screen.queryByText(/만료/)).not.toBeInTheDocument()
})

test('2단계 인증 — 인증 정보 조회가 무응답이면 지연 안내', async () => {
  auth.mfa.listFactors.mockReturnValue(hang())
  render(<MfaStepUp />)
  await wait(20_000)
  expect(screen.getByRole('alert')).toHaveTextContent(/응답이 지연/)
})

test('2단계 인증 — 코드 확인이 무응답이면 로딩을 풀고 지연 안내', async () => {
  auth.mfa.listFactors.mockResolvedValue({
    data: { all: [{ id: 'f1', factor_type: 'totp', status: 'verified', created_at: '' }] },
    error: null,
  })
  auth.mfa.challengeAndVerify.mockReturnValue(hang())
  render(<MfaStepUp />)
  await wait(0)
  fireEvent.change(screen.getByLabelText('인증 코드'), { target: { value: '123456' } })
  await click('확인')
  await wait(20_000)
  expect(screen.getByRole('alert')).toHaveTextContent(/응답이 지연/)
  expect(screen.getByRole('button', { name: '확인' })).toBeEnabled()
})

test('초대 수락 — 비밀번호 설정이 무응답이면 로딩을 풀고 지연 안내', async () => {
  auth.updateUser.mockReturnValue(hang())
  render(
    <InviteAccept token="t" view="needs_password" invitePath="/invite/t" inviteEmail="a@b.c" />
  )
  fireEvent.change(screen.getByPlaceholderText('사용할 비밀번호(8자 이상)'), {
    target: { value: 'Password1!' },
  })
  await click('비밀번호 정하고 참여하기')
  await wait(20_000)
  expect(screen.getByText(/응답이 지연/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '비밀번호 정하고 참여하기' })).toBeEnabled()
})
