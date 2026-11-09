import { act, fireEvent, render, screen } from '@testing-library/react'
import { LoginForm } from '../login-form'

const signInWithPassword = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithPassword } }),
}))

afterEach(() => jest.useRealTimers())

test('인증 서버가 응답하지 않으면 로딩을 풀고 지연 안내를 보여준다', async () => {
  jest.useFakeTimers()
  signInWithPassword.mockReturnValue(new Promise(() => {}))
  render(<LoginForm />)

  fireEvent.change(screen.getByPlaceholderText('name@example.com'), {
    target: { value: 'user@example.com' },
  })
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password1' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
  })
  expect(screen.getByRole('button', { name: '로그인 중...' })).toBeDisabled()

  await act(async () => {
    jest.advanceTimersByTime(20_000)
  })

  expect(screen.getByText(/응답이 지연/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled()
})
