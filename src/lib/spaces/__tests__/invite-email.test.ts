/** @jest-environment node */
const inviteUserByEmail = jest.fn()
jest.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdminClient: () => ({ auth: { admin: { inviteUserByEmail } } }),
}))

import { sendInviteEmail } from '../invite-email'

const input = {
  email: 'invitee@example.com',
  invitePath: '/invite/T',
  origin: 'https://app.example.com',
}

it('성공하면 sent:true, invite_path와 redirectTo를 넘긴다', async () => {
  inviteUserByEmail.mockResolvedValueOnce({ data: {}, error: null })
  expect(await sendInviteEmail(input)).toEqual({ sent: true })
  expect(inviteUserByEmail).toHaveBeenCalledWith('invitee@example.com', {
    data: { invite_path: '/invite/T' },
    redirectTo: 'https://app.example.com/auth/confirm',
  })
})

it.each([
  [{ code: 'email_exists', status: 422, message: 'x' }],
  [
    {
      code: undefined,
      status: 422,
      message: 'A user with this email address has already been registered',
    },
  ],
])('이미 가입한 이메일 %#은 already_registered', async (error) => {
  inviteUserByEmail.mockResolvedValueOnce({ data: {}, error })
  expect(await sendInviteEmail(input)).toEqual({ sent: false, reason: 'already_registered' })
})

it('다른 422·기타 오류는 send_failed', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  inviteUserByEmail.mockResolvedValueOnce({
    data: {},
    error: { code: 'email_address_invalid', status: 422, message: 'invalid' },
  })
  expect(await sendInviteEmail(input)).toEqual({ sent: false, reason: 'send_failed' })
  inviteUserByEmail.mockResolvedValueOnce({
    data: {},
    error: { code: 'over_email_send_rate_limit', status: 429, message: 'rate' },
  })
  expect(await sendInviteEmail(input)).toEqual({ sent: false, reason: 'send_failed' })
})
