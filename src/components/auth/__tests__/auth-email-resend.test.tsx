import { act, fireEvent, render, screen } from '@testing-library/react'
import { LoginForm } from '../login-form'
import { SignupForm } from '../signup-form'

const auth = { signInWithPassword: jest.fn(), resend: jest.fn(), signUp: jest.fn() }
const push = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }))
const { toast } = jest.requireMock('sonner')

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  sessionStorage.clear()
})
afterEach(() => jest.useRealTimers())

async function click(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}
const typeEmail = (v: string) =>
  fireEvent.change(screen.getByPlaceholderText('name@example.com'), { target: { value: v } })

test('인증 대기 배너 — 스팸함 안내와 다시 보내기 버튼', () => {
  render(<LoginForm isVerifyPending />)
  expect(screen.getByText(/스팸함/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '인증 메일 다시 보내기' })).toBeInTheDocument()
})

test('다시 보내기 — 이메일이 비었으면 입력 요청만 하고 발송하지 않는다', async () => {
  render(<LoginForm isVerifyPending />)
  await click('인증 메일 다시 보내기')
  expect(auth.resend).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/이메일/))
})

test('다시 보내기 — 성공하면 resend 호출 후 60초 쿨다운', async () => {
  auth.resend.mockResolvedValue({ error: null })
  render(<LoginForm isVerifyPending redirectTo="/d/abc" />)
  typeEmail('user@example.com')
  await click('인증 메일 다시 보내기')
  expect(auth.resend).toHaveBeenCalledWith({
    type: 'signup',
    email: 'user@example.com',
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback?type=email&next=${encodeURIComponent('/d/abc')}`,
    },
  })
  expect(toast.success).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: /60초 뒤/ })).toBeDisabled()
  for (let i = 0; i < 60; i++) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000)
    })
  }
  expect(screen.getByRole('button', { name: '인증 메일 다시 보내기' })).toBeEnabled()
})

test('다시 보내기 — 429 는 잠시 뒤 다시 시도 안내', async () => {
  auth.resend.mockResolvedValue({ error: { status: 429, message: 'rate limit' } })
  render(<LoginForm isVerifyPending />)
  typeEmail('user@example.com')
  await click('인증 메일 다시 보내기')
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/잠시 뒤/))
  expect(screen.getByRole('button', { name: '인증 메일 다시 보내기' })).toBeEnabled()
})

test('이메일 미인증 로그인 오류에도 다시 보내기 버튼', async () => {
  auth.signInWithPassword.mockResolvedValue({
    data: {},
    error: { status: 400, message: 'Email not confirmed' },
  })
  render(<LoginForm />)
  typeEmail('user@example.com')
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password1' } })
  await click('로그인')
  expect(screen.getByText(/인증이 완료되지 않았습니다/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '인증 메일 다시 보내기' })).toBeInTheDocument()
})

test('가입 — signup_next 를 싣고, 이미 가입 여부를 구분하지 않으며, 이메일을 임시 저장', async () => {
  auth.signUp.mockResolvedValue({ data: { user: { identities: [] } }, error: null })
  const { container } = render(<SignupForm redirectTo="/d/abc?x=1" />)
  typeEmail('user@example.com')
  fireEvent.change(screen.getByPlaceholderText('홍길동'), { target: { value: '홍길동' } })
  for (const input of container.querySelectorAll('input[type="password"]')) {
    fireEvent.change(input, { target: { value: 'Password1!' } })
  }
  await click('회원가입')
  expect(auth.signUp.mock.calls[0][0].options.data.signup_next).toBe('%2Fd%2Fabc%3Fx%3D1')
  expect(push).toHaveBeenCalledWith(expect.stringContaining('verified=pending'))
  expect(sessionStorage.getItem('wd:pending-email')).toBe('user@example.com')
})

test('로그인 — 가입 직후 임시 저장된 이메일로 이메일 칸을 채운다', async () => {
  sessionStorage.setItem('wd:pending-email', 'saved@example.com')
  render(<LoginForm isVerifyPending />)
  await act(async () => {})
  expect(screen.getByPlaceholderText('name@example.com')).toHaveValue('saved@example.com')
})
