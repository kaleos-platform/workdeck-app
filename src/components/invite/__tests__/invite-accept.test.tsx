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
    render(<InviteAccept token="tok" view={view} invitePath="/invite/tok" inviteEmail="a@b.com" />)
    fireEvent.click(screen.getByRole('button', { name: 'Google 계정으로 참여하기' }))
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled())
    expect(signInWithOAuth.mock.calls[0][0]).toEqual({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=%2Finvite%2Ftok` },
    })
  }
)

it('ready 화면에는 Google 버튼이 없다', () => {
  render(<InviteAccept token="tok" view="ready" invitePath="/invite/tok" inviteEmail="a@b.com" />)
  expect(screen.queryByRole('button', { name: 'Google 계정으로 참여하기' })).toBeNull()
})
