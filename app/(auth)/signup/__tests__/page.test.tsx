import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SignupPage from '../page'
import { isLeadGateEnabled, verifyLeadToken } from '@/lib/marketing/lead-signup'
import { getReleasedDeckIds } from '@/lib/billing/deck-release'
const auth = {
  signInWithOAuth: jest.fn().mockResolvedValue({ error: null }),
  signUp: jest.fn().mockResolvedValue({ error: null }),
  signOut: jest.fn().mockResolvedValue({ error: null }),
}
const router = { push: jest.fn(), refresh: jest.fn() }
jest.mock('next/navigation', () => ({ useRouter: () => router }))
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }))
jest.mock('@/lib/marketing/lead-signup', () => ({
  isLeadGateEnabled: jest.fn(),
  verifyLeadToken: jest.fn(),
}))
jest.mock('@/lib/billing/deck-release', () => ({ getReleasedDeckIds: jest.fn() }))
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(isLeadGateEnabled).mockReturnValue(true)
  jest.mocked(verifyLeadToken).mockResolvedValue(null)
  jest.mocked(getReleasedDeckIds).mockResolvedValue(['recruiting'])
})
it('토큰 없거나 무효면 이메일 폼 대신 도입 문의와 Google 버튼을 보여준다', async () => {
  render(await SignupPage({ searchParams: Promise.resolve({ lead: 'bad' }) }))
  expect(screen.queryByPlaceholderText('name@example.com')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '도입 문의하기' })).toHaveAttribute(
    'href',
    expect.stringContaining('/recruiting#lead-form')
  )
  expect(
    screen.getByRole('button', { name: '이미 문의했다면 Google 계정으로 계속' })
  ).toBeInTheDocument()
})
it('유효한 토큰이면 리드 이메일을 미리 채우고 고정한다', async () => {
  jest
    .mocked(verifyLeadToken)
    .mockResolvedValue({ email: 'lead@example.com', deck: 'recruiting' } as never)
  render(await SignupPage({ searchParams: Promise.resolve({ lead: 'signed' }) }))
  const input = screen.getByPlaceholderText('name@example.com')
  expect(input).toHaveValue('lead@example.com')
  expect(input).toHaveAttribute('readonly')
  expect(screen.getByText('이 이메일의 Google 계정으로 계속해 주세요.')).toBeInTheDocument()
})
it('off면 원래 가입 폼을 복구하고 이메일을 고정하지 않는다', async () => {
  jest.mocked(isLeadGateEnabled).mockReturnValue(false)
  render(await SignupPage({ searchParams: Promise.resolve({ email: 'normal@example.com' }) }))
  const input = screen.getByPlaceholderText('name@example.com')
  expect(input).toHaveValue('normal@example.com')
  expect(input).not.toHaveAttribute('readonly')
})
it('blocked 안내에서는 다른 Google 계정을 고를 수 있다', async () => {
  render(await SignupPage({ searchParams: Promise.resolve({ blocked: 'lead' }) }))
  expect(screen.getByRole('alert')).toHaveTextContent('도입 문의에 남긴 이메일과 다른 계정입니다')
  fireEvent.click(screen.getByRole('button', { name: '다른 Google 계정으로 계속' }))
  await waitFor(() =>
    expect(auth.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ queryParams: { prompt: 'select_account' } }),
      })
    )
  )
})

it('blocked 화면에서 세션을 종료한 뒤 이메일 로그인으로 이동한다', async () => {
  render(await SignupPage({ searchParams: Promise.resolve({ blocked: 'lead' }) }))
  fireEvent.click(screen.getByRole('button', { name: '다른 계정으로 로그인' }))
  await waitFor(() => expect(router.push).toHaveBeenCalledWith('/login'))
  expect(auth.signOut).toHaveBeenCalled()
  expect(auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(
    router.push.mock.invocationCallOrder[0]
  )
})
it('이메일 가입 metadata에 lead token과 원래 업무 목적지를 싣는다', async () => {
  jest
    .mocked(verifyLeadToken)
    .mockResolvedValue({ email: 'lead@example.com', deck: 'recruiting' } as never)
  render(await SignupPage({ searchParams: Promise.resolve({ lead: 'id.signed' }) }))
  fireEvent.change(screen.getByPlaceholderText('홍길동'), { target: { value: '테스트' } })
  for (const input of screen.getAllByPlaceholderText('••••••••'))
    fireEvent.change(input, { target: { value: 'Password1!' } })
  fireEvent.click(screen.getByRole('button', { name: '회원가입' }))
  await waitFor(() => expect(auth.signUp).toHaveBeenCalled())
  expect(auth.signUp.mock.calls[0][0]).toMatchObject({
    email: 'lead@example.com',
    options: {
      data: {
        lead_token: 'id.signed',
        signup_next: encodeURIComponent('/my-deck?subscribe=recruiting'),
      },
    },
  })
})
it('준비중 업무 리드는 기본 목적지에 subscribe 를 붙이지 않는다', async () => {
  jest.mocked(getReleasedDeckIds).mockResolvedValue([])
  jest
    .mocked(verifyLeadToken)
    .mockResolvedValue({ email: 'lead@example.com', deck: 'recruiting' } as never)
  render(await SignupPage({ searchParams: Promise.resolve({ lead: 'id.signed' }) }))
  fireEvent.change(screen.getByPlaceholderText('홍길동'), { target: { value: '테스트' } })
  for (const input of screen.getAllByPlaceholderText('••••••••'))
    fireEvent.change(input, { target: { value: 'Password1!' } })
  fireEvent.click(screen.getByRole('button', { name: '회원가입' }))
  await waitFor(() => expect(auth.signUp).toHaveBeenCalled())
  expect(auth.signUp.mock.calls[0][0].options.data.signup_next).toBe(encodeURIComponent('/my-deck'))
})
