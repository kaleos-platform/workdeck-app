import { act, fireEvent, render, screen } from '@testing-library/react'
import { SignupForm } from '../signup-form'
import { ResetPasswordForm } from '../reset-password-form'

const signUp = jest.fn()
const updateUser = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signUp, updateUser, signOut: jest.fn() } }),
}))

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const hang = () => new Promise(() => {})

async function submitAndWait(button: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: button }))
  })
  await act(async () => {
    jest.advanceTimersByTime(20_000)
  })
}

test('회원가입 — 인증 서버 무응답이면 로딩을 풀고 지연 안내를 보여준다', async () => {
  const { toast } = jest.requireMock('sonner')
  signUp.mockReturnValue(hang())
  const { container } = render(<SignupForm />)
  for (const input of container.querySelectorAll('input')) {
    const value =
      input.type === 'email'
        ? 'user@example.com'
        : input.type === 'password'
          ? 'Password1!'
          : 'tester'
    fireEvent.change(input, { target: { value } })
  }

  await submitAndWait('회원가입')

  expect(signUp).toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/응답이 지연/))
  expect(screen.getByRole('button', { name: '회원가입' })).toBeEnabled()
})

test('비밀번호 변경 — 인증 서버 무응답이면 로딩을 풀고 지연 안내를 보여준다', async () => {
  updateUser.mockReturnValue(hang())
  const { container } = render(<ResetPasswordForm />)
  for (const input of container.querySelectorAll('input[type="password"]')) {
    fireEvent.change(input, { target: { value: 'Password1!' } })
  }

  await submitAndWait('비밀번호 변경')

  expect(updateUser).toHaveBeenCalled()
  expect(screen.getByText(/응답이 지연/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '비밀번호 변경' })).toBeEnabled()
})
