/** @jest-environment node */
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/admin/auth', () => ({ writeAuditLog: jest.fn() }))
jest.mock('@/lib/spaces/invitations', () => {
  const actual = jest.requireActual('@/lib/spaces/invitations')
  return { ...actual, findInvitationByToken: jest.fn(), acceptInvitation: jest.fn() }
})

import { Prisma } from '@/generated/prisma/client'
import { getUser } from '@/hooks/use-user'
import { writeAuditLog } from '@/lib/admin/auth'
import { InvitationError, acceptInvitation, findInvitationByToken } from '@/lib/spaces/invitations'
import { GET } from '../route'
import { POST } from '../accept/route'

const params = { params: Promise.resolve({ token: 'TOK' }) }
const inv = {
  id: 'inv-1',
  spaceId: 'sp-1',
  spaceName: '테스트 Space',
  email: 'invitee@example.com',
  role: 'ADMIN',
  invitedByName: '소유자',
  expiresAt: new Date(Date.now() + 86_400_000),
  acceptedAt: null,
  revokedAt: null,
}

beforeEach(() => jest.clearAllMocks())

it('GET: 유효한 초대는 이메일을 가려 보여 준다', async () => {
  ;(findInvitationByToken as jest.Mock).mockResolvedValue(inv)
  const res = await GET(new Request('https://x'), params)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toMatchObject({
    spaceName: '테스트 Space',
    role: 'ADMIN',
    invitedByName: '소유자',
    email: 'in***@example.com',
  })
  expect(JSON.stringify(body)).not.toContain('invitee@example.com')
  expect(body).not.toHaveProperty('spaceId')
})

it('GET: 없는 토큰 404, 만료 410', async () => {
  ;(findInvitationByToken as jest.Mock).mockResolvedValueOnce(null)
  expect((await GET(new Request('https://x'), params)).status).toBe(404)
  ;(findInvitationByToken as jest.Mock).mockResolvedValueOnce({
    ...inv,
    expiresAt: new Date(Date.now() - 1),
  })
  const res = await GET(new Request('https://x'), params)
  expect(res.status).toBe(410)
  expect((await res.json()).reason).toBe('expired')
})

it('POST accept: 비로그인 401', async () => {
  ;(getUser as jest.Mock).mockResolvedValue(null)
  expect((await POST(new Request('https://x', { method: 'POST' }), params)).status).toBe(401)
  expect(acceptInvitation).not.toHaveBeenCalled()
})

it('POST accept: 세션 사용자로 수락하고 감사 로그', async () => {
  ;(getUser as jest.Mock).mockResolvedValue({
    id: 'u-1',
    email: 'invitee@example.com',
    email_confirmed_at: '2026-10-15T00:00:00Z',
    user_metadata: { name: '초대받은 사람' },
  })
  ;(acceptInvitation as jest.Mock).mockResolvedValue({ spaceId: 'sp-1', invitationId: 'inv-1' })
  const res = await POST(new Request('https://x', { method: 'POST' }), params)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ spaceId: 'sp-1' })
  expect(acceptInvitation).toHaveBeenCalledWith({
    token: 'TOK',
    user: { id: 'u-1', email: 'invitee@example.com', emailConfirmed: true, name: '초대받은 사람' },
  })
  expect(writeAuditLog).toHaveBeenCalledWith(
    'u-1',
    'space.invitation.accept',
    'space_invitation',
    'inv-1',
    { spaceId: 'sp-1' }
  )
})

it('POST accept: 도메인 오류는 상태·사유로', async () => {
  ;(getUser as jest.Mock).mockResolvedValue({
    id: 'u-1',
    email: 'other@example.com',
    email_confirmed_at: null,
    user_metadata: {},
  })
  ;(acceptInvitation as jest.Mock).mockRejectedValue(new InvitationError(403, 'email_mismatch'))
  const res = await POST(new Request('https://x', { method: 'POST' }), params)
  expect(res.status).toBe(403)
  expect((await res.json()).reason).toBe('email_mismatch')
  expect(acceptInvitation).toHaveBeenCalledWith(
    expect.objectContaining({ user: expect.objectContaining({ emailConfirmed: false }) })
  )
})

it('POST accept: 고유 제약 충돌(P2002)은 500이 아니라 409', async () => {
  ;(getUser as jest.Mock).mockResolvedValue({
    id: 'u-1',
    email: 'invitee@example.com',
    email_confirmed_at: '2026-10-15T00:00:00Z',
    user_metadata: {},
  })
  ;(acceptInvitation as jest.Mock).mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'x',
    })
  )
  const res = await POST(new Request('https://x', { method: 'POST' }), params)
  expect(res.status).toBe(409)
  expect((await res.json()).reason).toBe('conflict')
  expect(writeAuditLog).not.toHaveBeenCalled()
})
