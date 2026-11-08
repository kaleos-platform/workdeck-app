import { renderToString } from 'react-dom/server'
import { render, screen } from '@testing-library/react'
import { LoginForm } from '../login-form'
import { SignupForm } from '../signup-form'
import { ResetPasswordForm } from '../reset-password-form'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: {} }) }))

test.each([
  ['로그인', LoginForm],
  ['회원가입', SignupForm],
  ['비밀번호 변경', ResetPasswordForm],
])('%s 폼은 서버 렌더링 시 입력이 잠기고 GET으로 전송되지 않는다', (_name, Component) => {
  const html = renderToString(<Component />)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const password = doc.querySelector('input[type="password"]')!
  const form = password.closest('form')!
  expect(form.getAttribute('method')).toBe('post')
  expect(password.closest('fieldset')?.disabled).toBe(true)
})

test('클라이언트 초기화 후 로그인 입력을 사용할 수 있다', () => {
  render(<LoginForm />)
  expect(screen.getByPlaceholderText('••••••••')).toBeEnabled()
})
