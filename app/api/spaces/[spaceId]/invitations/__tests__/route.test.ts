/** @jest-environment node */
jest.mock('@/lib/agent/identity/space-admin', () => ({ requireSpaceOwner: jest.fn() }))
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn() }))
jest.mock('@/lib/admin/auth', () => ({ writeAuditLog: jest.fn() }))
jest.mock('@/lib/spaces/invite-email', () => ({ sendInviteEmail: jest.fn() }))
jest.mock('@/lib/spaces/invitations', () => {
  const actual = jest.requireActual('@/lib/spaces/invitations')
  return {
    ...actual,
    createInvitation: jest.fn(),
    listPendingInvitations: jest.fn(),
    revokeInvitation: jest.fn(),
  }
})

import { requireSpaceOwner } from '@/lib/agent/identity/space-admin'
import { requireAal2 } from '@/lib/auth/mfa'
import { writeAuditLog } from '@/lib/admin/auth'
import { sendInviteEmail } from '@/lib/spaces/invite-email'
import {
  InvitationError,
  createInvitation,
  listPendingInvitations,
  revokeInvitation,
} from '@/lib/spaces/invitations'
import { GET, POST } from '../route'
import { DELETE } from '../[invitationId]/route'

const params = () => ({ params: Promise.resolve({ spaceId: 'sp-1' }) })
const delParams = (invitationId: string) => ({
  params: Promise.resolve({ spaceId: 'sp-1', invitationId }),
})
const post = (body: unknown) =>
  POST(
    new Request('https://app.example.com/api/spaces/sp-1/invitations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    params()
  )

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireSpaceOwner as jest.Mock).mockResolvedValue({ userId: 'u-owner' })
  ;(requireAal2 as jest.Mock).mockResolvedValue(null)
  ;(createInvitation as jest.Mock).mockResolvedValue({
    invitation: {
      id: 'inv-1',
      email: 'invitee@example.com',
      role: 'ADMIN',
      expiresAt: new Date('2026-10-22T00:00:00Z'),
    },
    token: 'TOKEN123',
  })
  ;(sendInviteEmail as jest.Mock).mockResolvedValue({ sent: true })
})

it('OWNER가 아니면 그 오류, 초대하지 않는다', async () => {
  const denied = new Response(null, { status: 403 })
  ;(requireSpaceOwner as jest.Mock).mockResolvedValue({ error: denied })
  expect((await post({ email: 'invitee@example.com', role: 'ADMIN' })).status).toBe(403)
  expect(createInvitation).not.toHaveBeenCalled()
})

it('MFA(aal2)가 아니면 그 오류', async () => {
  ;(requireAal2 as jest.Mock).mockResolvedValue(new Response(null, { status: 403 }))
  expect((await post({ email: 'invitee@example.com', role: 'ADMIN' })).status).toBe(403)
  expect(createInvitation).not.toHaveBeenCalled()
})

it('OWNER 역할·잘못된 이메일은 422', async () => {
  expect((await post({ email: 'invitee@example.com', role: 'OWNER' })).status).toBe(422)
  expect((await post({ email: 'nope', role: 'ADMIN' })).status).toBe(422)
})

it('초대를 만들고 메일을 보내고 링크를 돌려준다(감사 로그에 토큰 없음)', async () => {
  const res = await post({ email: 'Invitee@Example.com', role: 'ADMIN' })
  expect(res.status).toBe(201)
  const body = await res.json()
  expect(body).toMatchObject({
    invitationId: 'inv-1',
    link: 'https://app.example.com/invite/TOKEN123',
    emailSent: true,
  })
  expect(sendInviteEmail).toHaveBeenCalledWith({
    email: 'invitee@example.com',
    invitePath: '/invite/TOKEN123',
    origin: 'https://app.example.com',
  })
  expect(JSON.stringify((writeAuditLog as jest.Mock).mock.calls)).not.toContain('TOKEN123')
  expect(writeAuditLog).toHaveBeenCalledWith(
    'u-owner',
    'space.invitation.create',
    'space_invitation',
    'inv-1',
    { spaceId: 'sp-1', email: 'invitee@example.com', role: 'ADMIN' }
  )
})

it('이미 가입한 이메일이면 초대는 유지하고 emailSent:false', async () => {
  ;(sendInviteEmail as jest.Mock).mockResolvedValue({ sent: false, reason: 'already_registered' })
  const body = await (await post({ email: 'invitee@example.com', role: 'MEMBER' })).json()
  expect(body).toMatchObject({
    emailSent: false,
    emailSkipReason: 'already_registered',
    link: 'https://app.example.com/invite/TOKEN123',
  })
})

it('도메인 오류는 상태 코드와 메시지로', async () => {
  ;(createInvitation as jest.Mock).mockRejectedValue(new InvitationError(409, 'already_member'))
  const res = await post({ email: 'invitee@example.com', role: 'ADMIN' })
  expect(res.status).toBe(409)
  expect((await res.json()).message).toBe('이미 이 Space의 구성원입니다')
})

it('GET은 OWNER+MFA, 대기 목록', async () => {
  ;(listPendingInvitations as jest.Mock).mockResolvedValue([{ id: 'inv-1' }])
  const res = await GET(new Request('https://app.example.com/x'), params())
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ invitations: [{ id: 'inv-1' }] })
  expect(listPendingInvitations).toHaveBeenCalledWith('sp-1')
})

it('DELETE: 이 Space의 대기 초대가 아니면 404, 맞으면 감사 로그', async () => {
  ;(revokeInvitation as jest.Mock).mockResolvedValueOnce(false)
  expect(
    (await DELETE(new Request('https://x', { method: 'DELETE' }), delParams('inv-9'))).status
  ).toBe(404)
  ;(revokeInvitation as jest.Mock).mockResolvedValueOnce(true)
  expect(
    (await DELETE(new Request('https://x', { method: 'DELETE' }), delParams('inv-1'))).status
  ).toBe(200)
  expect(revokeInvitation).toHaveBeenLastCalledWith('sp-1', 'inv-1')
  expect(writeAuditLog).toHaveBeenCalledWith(
    'u-owner',
    'space.invitation.revoke',
    'space_invitation',
    'inv-1',
    { spaceId: 'sp-1' }
  )
})
