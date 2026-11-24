import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createClient } from '@/lib/supabase/client'
import { InviteAccept } from '../invite-accept'

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }))
jest.mock('@/lib/supabase/client', () => ({ createClient: jest.fn() }))

const signInWithOAuth = jest.fn().mockResolvedValue({ error: null })
beforeEach(() => {
  jest.clearAllMocks()
  ;(createClient as jest.Mock).mockReturnValue({ auth: { signInWithOAuth } })
})

it.each(['anonymous', 'needs_password'] as const)(
  '%s 화면에서 Google 로 참여하면 초대 화면으로 돌아오게 OAuth 를 시작한다',
  async (view) => {
    render(<InviteAccept token="tok" view={view} invitePath="/invite/tok" />)
    fireEvent.click(screen.getByRole('button', { name: 'Google 계정으로 참여하기' }))
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled())
    expect(signInWithOAuth.mock.calls[0][0]).toEqual({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=%2Finvite%2Ftok` },
    })
  }
)

it('ready 화면에는 Google 버튼이 없다', () => {
  render(<InviteAccept token="tok" view="ready" invitePath="/invite/tok" />)
  expect(screen.queryByRole('button', { name: 'Google 계정으로 참여하기' })).toBeNull()
})

describe('anonymous 이메일 인증 폼', () => {
  const fetchMock = jest.fn()
  beforeEach(() => {
    global.fetch = fetchMock
  })
  const submit = (value = 'a@b.com') => {
    render(<InviteAccept token="tok" view="anonymous" invitePath="/invite/tok" />)
    fireEvent.change(screen.getByLabelText('초대받은 이메일'), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: '인증 메일 받기' }))
  }
  const reply = (status: number, body: object) =>
    fetchMock.mockResolvedValue({ ok: status < 300, status, json: async () => body })

  it('비밀번호 입력란이 없고 일반 가입 링크도 없다', () => {
    const { container } = render(
      <InviteAccept token="tok" view="anonymous" invitePath="/invite/tok" />
    )
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(screen.queryByRole('link', { name: '가입하기' })).toBeNull()
  })

  it('이메일만 보내고 성공하면 안내와 다시 보내기(쿨다운)를 보여 준다', async () => {
    reply(200, { sent: true })
    submit()
    expect(await screen.findByText(/스팸함이나 회사 메일 격리함/)).toBeTruthy()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'a@b.com' })
    expect(
      (screen.getByRole('button', { name: /다시 보내기/ }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('이메일이 다르면 안내 문구를 보여 준다', async () => {
    reply(400, { reason: 'email_mismatch' })
    submit('x@y.com')
    expect(await screen.findByText(/초대받은 이메일과 다릅니다/)).toBeTruthy()
  })

  it('이미 계정이 있으면 로그인·비밀번호 찾기 링크를 보여 준다', async () => {
    reply(409, { reason: 'registered' })
    submit()
    expect(await screen.findByText(/이미 워크덱 계정이 있습니다/)).toBeTruthy()
    expect(screen.getAllByRole('link', { name: '로그인' })[0].getAttribute('href')).toBe(
      '/login?redirectTo=%2Finvite%2Ftok'
    )
    expect(screen.getByRole('link', { name: '비밀번호 찾기' })).toBeTruthy()
  })

  it('429는 잠시 후 다시 시도 안내', async () => {
    reply(429, { reason: 'rate_limited' })
    submit()
    expect(await screen.findByText(/잠시 후 다시 시도하세요/)).toBeTruthy()
  })
})
