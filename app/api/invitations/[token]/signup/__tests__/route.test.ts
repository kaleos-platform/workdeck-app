/** @jest-environment node */
jest.mock('@/lib/admin/auth', () => ({ writeAuditLog: jest.fn() }))
jest.mock('@/lib/domain', () => ({ getAppOrigin: () => 'https://app.test' }))
jest.mock('@/lib/hiring/applications', () => ({ checkRateLimit: jest.fn() }))
jest.mock('@/lib/hiring/public-request', () => ({ publicRequestKey: () => 'ip' }))
jest.mock('@/lib/prisma', () => ({
  prisma: { adminAuditLog: { count: jest.fn() }, user: { findFirst: jest.fn() } },
}))
jest.mock('@/lib/spaces/invite-signup-email', () => ({ sendInviteSignupEmail: jest.fn() }))
jest.mock('@/lib/spaces/invitations', () => {
  const actual = jest.requireActual('@/lib/spaces/invitations')
  return { ...actual, findInvitationByToken: jest.fn() }
})
const generateLink = jest.fn()
const updateUserById = jest.fn()
jest.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdminClient: () => ({ auth: { admin: { generateLink, updateUserById } } }),
}))

import { writeAuditLog } from '@/lib/admin/auth'
import { checkRateLimit } from '@/lib/hiring/applications'
import { prisma } from '@/lib/prisma'
import { sendInviteSignupEmail } from '@/lib/spaces/invite-signup-email'
import { findInvitationByToken } from '@/lib/spaces/invitations'
import { POST } from '../route'

const params = { params: Promise.resolve({ token: 'TOK' }) }
const inv = {
  id: 'inv-1',
  spaceId: 'sp-1',
  spaceName: '테스트 Space',
  email: 'invitee@example.com',
  role: 'MEMBER',
  invitedByName: '소유자',
  expiresAt: new Date(Date.now() + 86_400_000),
  acceptedAt: null,
  revokedAt: null,
}
const call = (email = 'Invitee@Example.com') =>
  POST(new Request('https://x', { method: 'POST', body: JSON.stringify({ email }) }), params)
const ok = (type: string, createdAt = new Date().toISOString()) => ({
  data: { user: { id: 'au-1', created_at: createdAt }, properties: { hashed_token: 'HASH' } },
  error: null,
  type,
})
const existsError = {
  data: { user: null, properties: null },
  error: { code: 'email_exists', status: 422, message: 'x' },
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(findInvitationByToken as jest.Mock).mockResolvedValue(inv)
  ;(checkRateLimit as jest.Mock).mockReturnValue(true)
  ;(prisma.adminAuditLog.count as jest.Mock).mockResolvedValue(0)
  ;(sendInviteSignupEmail as jest.Mock).mockResolvedValue(true)
  generateLink.mockResolvedValue(ok('invite'))
  updateUserById.mockResolvedValue({ data: {}, error: null })
})

it('이메일이 다르면 400 email_mismatch, 응답에 원문 없음', async () => {
  const res = await call('other@example.com')
  expect(res.status).toBe(400)
  const text = JSON.stringify(await res.json())
  expect(text).toContain('email_mismatch')
  expect(text).not.toContain('invitee@example.com')
  expect(generateLink).not.toHaveBeenCalled()
})

it('없는 초대 404, 만료 초대 410', async () => {
  ;(findInvitationByToken as jest.Mock).mockResolvedValueOnce(null)
  expect((await call()).status).toBe(404)
  ;(findInvitationByToken as jest.Mock).mockResolvedValueOnce({
    ...inv,
    expiresAt: new Date(Date.now() - 1000),
  })
  expect((await call()).status).toBe(410)
})

it('비밀번호 필드는 무시하고 이메일만 쓴다', async () => {
  const res = await POST(
    new Request('https://x', {
      method: 'POST',
      body: JSON.stringify({ email: inv.email, password: 'secret-pass-1' }),
    }),
    params
  )
  expect(res.status).toBe(200)
  expect(JSON.stringify(generateLink.mock.calls)).not.toContain('secret-pass-1')
})

it('60초 안 재요청 429, 시간당 5회 초과 429', async () => {
  ;(prisma.adminAuditLog.count as jest.Mock).mockResolvedValueOnce(1).mockResolvedValueOnce(1)
  expect((await call()).status).toBe(429)
  ;(prisma.adminAuditLog.count as jest.Mock).mockResolvedValueOnce(0).mockResolvedValueOnce(5)
  expect((await call()).status).toBe(429)
  expect(sendInviteSignupEmail).not.toHaveBeenCalled()
})

it('IP 제한 429', async () => {
  ;(checkRateLimit as jest.Mock).mockReturnValue(false)
  expect((await call()).status).toBe(429)
})

it('신규/미인증 사용자는 invite 링크로 발송하고 감사 기록을 남긴다', async () => {
  const res = await call()
  expect(res.status).toBe(200)
  expect(generateLink).toHaveBeenCalledWith({
    type: 'invite',
    email: 'invitee@example.com',
    options: { data: { invite_path: '/invite/TOK' } },
  })
  expect((sendInviteSignupEmail as jest.Mock).mock.calls[0][0].link).toBe(
    'https://app.test/auth/confirm?token_hash=HASH&type=invite&next=%2Finvite%2FTOK'
  )
  expect(writeAuditLog).toHaveBeenCalledWith(
    'anonymous',
    'space.invitation.self_verify',
    'space_invitation',
    'inv-1'
  )
})

it('앱 User 행 있음 → 409 registered, 링크도 만들지 않음', async () => {
  ;(prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'au-1' })
  const res = await call()
  expect(res.status).toBe(409)
  expect((await res.json()).reason).toBe('registered')
  expect(sendInviteSignupEmail).not.toHaveBeenCalled()
  expect(writeAuditLog).not.toHaveBeenCalled()
  expect(generateLink).not.toHaveBeenCalled()
})

it('인증된 사용자 + 앱 User 행 없음 → magiclink 로 발송', async () => {
  generateLink.mockResolvedValueOnce(existsError).mockResolvedValueOnce(ok('magiclink'))
  const res = await call()
  expect(res.status).toBe(200)
  expect(generateLink.mock.calls[1][0]).toEqual({ type: 'magiclink', email: 'invitee@example.com' })
  expect((sendInviteSignupEmail as jest.Mock).mock.calls[0][0].link).toContain('type=magiclink')
})

it('발송 직전 초대가 재발급됐으면 409 stale', async () => {
  ;(findInvitationByToken as jest.Mock).mockResolvedValueOnce(inv).mockResolvedValueOnce(null)
  const res = await call()
  expect(res.status).toBe(409)
  expect((await res.json()).reason).toBe('stale')
  expect(generateLink).not.toHaveBeenCalled()
})

it('메일 발송 실패는 502, 제한 기록을 남기지 않는다', async () => {
  ;(sendInviteSignupEmail as jest.Mock).mockRejectedValue(new Error('resend 500'))
  const res = await call()
  expect(res.status).toBe(502)
  expect((await res.json()).reason).toBe('send_failed')
  expect(writeAuditLog).not.toHaveBeenCalled()
})

it('이전부터 있던 미인증 계정이면 비밀번호를 무작위로 무효화한 뒤 발송', async () => {
  generateLink.mockResolvedValue(ok('invite', new Date(Date.now() - 86_400_000).toISOString()))
  const res = await call()
  expect(res.status).toBe(200)
  expect(updateUserById).toHaveBeenCalledWith('au-1', { password: expect.any(String) })
})

it('방금 만든 계정이면 비밀번호를 건드리지 않음', async () => {
  const res = await call()
  expect(res.status).toBe(200)
  expect(updateUserById).not.toHaveBeenCalled()
})

it('비밀번호 무효화 실패 시 발송하지 않고 502', async () => {
  generateLink.mockResolvedValue(ok('invite', new Date(Date.now() - 86_400_000).toISOString()))
  updateUserById.mockResolvedValue({ data: null, error: { code: 'x' } })
  const res = await call()
  expect(res.status).toBe(502)
  expect(sendInviteSignupEmail).not.toHaveBeenCalled()
})

it('발송 기록 실패해도 200', async () => {
  ;(writeAuditLog as jest.Mock).mockRejectedValue(new Error('db'))
  const res = await call()
  expect(res.status).toBe(200)
})
