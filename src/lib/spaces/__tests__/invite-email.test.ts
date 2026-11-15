/** @jest-environment node */
const inviteUserByEmail = jest.fn()
const generateLink = jest.fn()
const updateUserById = jest.fn()
jest.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdminClient: () => ({
    auth: { admin: { inviteUserByEmail, generateLink, updateUserById } },
  }),
}))

const sendMemberInviteEmail = jest.fn()
jest.mock('../member-invite-email', () => ({
  sendMemberInviteEmail: (...a: unknown[]) => sendMemberInviteEmail(...a),
}))
const spaceFind = jest.fn()
const userFind = jest.fn()
jest.mock('@/lib/prisma', () => ({
  prisma: {
    space: { findUnique: (...a: unknown[]) => spaceFind(...a) },
    user: { findUnique: (...a: unknown[]) => userFind(...a) },
  },
}))

import { sendInviteEmail } from '../invite-email'

const input = {
  email: 'invitee@example.com',
  invitePath: '/invite/T',
  origin: 'https://app.example.com',
  invitationId: 'inv-1',
  spaceId: 'sp-1',
  inviterId: 'u-owner',
  role: 'ADMIN' as const,
  expiresAt: new Date('2026-11-22T00:00:00Z'),
}
const linkUser = (meta: Record<string, unknown>) => ({
  data: { user: { id: 'su-1', user_metadata: meta } },
  error: null,
})

beforeEach(() => {
  jest.clearAllMocks()
  // 기본: 새 사용자 — generateLink가 invite_path를 담아 만든다.
  generateLink.mockResolvedValue(linkUser({ invite_path: '/invite/T' }))
  updateUserById.mockResolvedValue({ data: {}, error: null })
  spaceFind.mockResolvedValue({ name: '테스트' })
  userFind.mockResolvedValue({ name: '소유자', email: 'owner@example.com' })
  sendMemberInviteEmail.mockResolvedValue(true)
})

it('성공하면 sent:true, invite_path와 redirectTo를 넘긴다', async () => {
  inviteUserByEmail.mockResolvedValueOnce({ data: {}, error: null })
  expect(await sendInviteEmail(input)).toEqual({ sent: true, via: 'supabase' })
  expect(inviteUserByEmail).toHaveBeenCalledWith('invitee@example.com', {
    data: { invite_path: '/invite/T' },
    redirectTo: 'https://app.example.com/auth/confirm',
  })
  expect(generateLink).toHaveBeenCalledWith({
    type: 'invite',
    email: 'invitee@example.com',
    options: { data: { invite_path: '/invite/T' } },
  })
  expect(updateUserById).not.toHaveBeenCalled()
})

it('재초대: 기존 미확인 사용자의 invite_path가 옛 토큰이면 갱신한 뒤에 보낸다', async () => {
  generateLink.mockResolvedValueOnce(linkUser({ invite_path: '/invite/OLD', x: 1 }))
  inviteUserByEmail.mockResolvedValueOnce({ data: {}, error: null })
  expect(await sendInviteEmail(input)).toEqual({ sent: true, via: 'supabase' })
  expect(updateUserById).toHaveBeenCalledWith('su-1', {
    user_metadata: { invite_path: '/invite/T', x: 1 },
  })
  expect(updateUserById.mock.invocationCallOrder[0]).toBeLessThan(
    inviteUserByEmail.mock.invocationCallOrder[0]
  )
})

it('재초대: invite_path 갱신에 실패하면 옛 링크 메일을 보내지 않고 stale_resend', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  generateLink.mockResolvedValueOnce(linkUser({ invite_path: '/invite/OLD' }))
  updateUserById.mockResolvedValueOnce({ data: {}, error: { status: 500, message: 'x' } })
  expect(await sendInviteEmail(input)).toEqual({ sent: false, reason: 'stale_resend' })
  expect(inviteUserByEmail).not.toHaveBeenCalled()
})

const sendArgs = {
  to: 'invitee@example.com',
  link: 'https://app.example.com/invite/T',
  token: 'T',
  invitationId: 'inv-1',
  spaceName: '테스트',
  inviterName: '소유자',
  role: 'ADMIN',
  expiresAt: input.expiresAt,
}

it('generateLink 단계의 email_exists는 Resend 가입자 메일, Supabase 메일 시도 안 함', async () => {
  generateLink.mockResolvedValueOnce({
    data: { user: null },
    error: { code: 'email_exists', status: 422, message: 'x' },
  })
  expect(await sendInviteEmail(input)).toEqual({ sent: true, via: 'resend' })
  expect(inviteUserByEmail).not.toHaveBeenCalled()
  expect(sendMemberInviteEmail).toHaveBeenCalledWith(sendArgs)
})

it('가입자 메일: RESEND 키 없음(false)이면 send_failed', async () => {
  generateLink.mockResolvedValueOnce({
    data: { user: null },
    error: { code: 'email_exists', status: 422, message: 'x' },
  })
  sendMemberInviteEmail.mockResolvedValueOnce(false)
  expect(await sendInviteEmail(input)).toEqual({ sent: false, reason: 'send_failed' })
})

it('가입자 메일: Resend 예외는 삼키고 send_failed', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  generateLink.mockResolvedValueOnce({
    data: { user: null },
    error: { code: 'email_exists', status: 422, message: 'x' },
  })
  sendMemberInviteEmail.mockRejectedValueOnce(new Error('resend 500'))
  expect(await sendInviteEmail(input)).toEqual({ sent: false, reason: 'send_failed' })
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
])('이미 가입한 이메일 %#은 Resend 로 보낸다', async (error) => {
  inviteUserByEmail.mockResolvedValueOnce({ data: {}, error })
  expect(await sendInviteEmail(input)).toEqual({ sent: true, via: 'resend' })
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
