/** @jest-environment node */
jest.mock('@/lib/agent/identity/space-admin', () => ({ requireSpaceOwner: jest.fn() }))
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn(), isAal2Fresh: jest.fn() }))
jest.mock('@/lib/domain', () => ({ getAppOrigin: () => 'https://app.example.com' }))
jest.mock('@/lib/admin/auth', () => ({ writeAuditLog: jest.fn() }))
jest.mock('@/lib/spaces/invite-email', () => ({ sendInviteEmail: jest.fn() }))
jest.mock('@/lib/spaces/invitations', () => {
  const actual = jest.requireActual('@/lib/spaces/invitations')
  return {
    ...actual,
    createInvitation: jest.fn(),
    listInvitations: jest.fn(),
    revokeInvitation: jest.fn(),
    resendInvitation: jest.fn(),
    recordSendResult: jest.fn(),
  }
})

import { requireSpaceOwner } from '@/lib/agent/identity/space-admin'
import { isAal2Fresh, requireAal2 } from '@/lib/auth/mfa'
import { writeAuditLog } from '@/lib/admin/auth'
import { sendInviteEmail } from '@/lib/spaces/invite-email'
import {
  InvitationError,
  createInvitation,
  listInvitations,
  recordSendResult,
  resendInvitation,
  revokeInvitation,
} from '@/lib/spaces/invitations'
import { GET, POST } from '../route'
import { DELETE } from '../[invitationId]/route'
import { POST as RESEND } from '../[invitationId]/resend/route'

const params = () => ({ params: Promise.resolve({ spaceId: 'sp-1' }) })
const delParams = (invitationId: string) => ({
  params: Promise.resolve({ spaceId: 'sp-1', invitationId }),
})
const post = (body: unknown) =>
  POST(
    new Request('https://other-host.example.net/api/spaces/sp-1/invitations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    params()
  )

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireSpaceOwner as jest.Mock).mockResolvedValue({ userId: 'u-owner' })
  ;(requireAal2 as jest.Mock).mockResolvedValue(null)
  ;(isAal2Fresh as jest.Mock).mockResolvedValue(true)
  ;(createInvitation as jest.Mock).mockResolvedValue({
    invitation: {
      id: 'inv-1',
      email: 'invitee@example.com',
      role: 'ADMIN',
      expiresAt: new Date('2026-10-22T00:00:00Z'),
    },
    token: 'TOKEN123',
    resent: false,
  })
  ;(sendInviteEmail as jest.Mock).mockResolvedValue({ sent: true, via: 'supabase' })
})

it('개인 Space가 전환되면 space.type.convert 감사 로그를 남긴다', async () => {
  ;(createInvitation as jest.Mock).mockResolvedValue({
    invitation: {
      id: 'inv-1',
      email: 'invitee@example.com',
      role: 'MEMBER',
      expiresAt: new Date(),
    },
    token: 'TOKEN123',
    converted: true,
  })
  expect((await post({ email: 'invitee@example.com', role: 'MEMBER' })).status).toBe(201)
  expect(writeAuditLog).toHaveBeenCalledWith('u-owner', 'space.type.convert', 'space', 'sp-1', {
    from: 'PERSONAL',
    to: 'ORGANIZATION',
    via: 'invitation',
  })
})

it('전환이 없으면 전환 감사 로그도 없다', async () => {
  await post({ email: 'invitee@example.com', role: 'ADMIN' })
  const actions = (writeAuditLog as jest.Mock).mock.calls.map((c) => c[1])
  expect(actions).not.toContain('space.type.convert')
})

it('OWNER가 아니면 그 오류, 초대하지 않는다', async () => {
  const denied = new Response(null, { status: 403 })
  ;(requireSpaceOwner as jest.Mock).mockResolvedValue({ error: denied })
  expect((await post({ email: 'invitee@example.com', role: 'ADMIN' })).status).toBe(403)
  expect(createInvitation).not.toHaveBeenCalled()
})

it('ADMIN 초대는 MFA(aal2)가 아니면 그 오류', async () => {
  ;(requireAal2 as jest.Mock).mockResolvedValue(new Response(null, { status: 403 }))
  ;(isAal2Fresh as jest.Mock).mockResolvedValue(false)
  expect((await post({ email: 'invitee@example.com', role: 'ADMIN' })).status).toBe(403)
  expect(createInvitation).not.toHaveBeenCalled()
})

it('AAL1 이어도 MEMBER 초대는 201, 감사 로그에 aal1', async () => {
  ;(requireAal2 as jest.Mock).mockResolvedValue(new Response(null, { status: 403 }))
  ;(isAal2Fresh as jest.Mock).mockResolvedValue(false)
  ;(createInvitation as jest.Mock).mockResolvedValue({
    invitation: {
      id: 'inv-2',
      email: 'invitee@example.com',
      role: 'MEMBER',
      expiresAt: new Date(),
    },
    token: 'T2',
    converted: false,
    resent: false,
  })
  expect((await post({ email: 'invitee@example.com', role: 'MEMBER' })).status).toBe(201)
  expect(requireAal2).not.toHaveBeenCalled()
  expect(writeAuditLog).toHaveBeenCalledWith(
    'u-owner',
    'space.invitation.create',
    'space_invitation',
    'inv-2',
    { spaceId: 'sp-1', email: 'invitee@example.com', role: 'MEMBER', aal: 'aal1' }
  )
})

it('AAL1 로 대기 MEMBER 초대를 ADMIN 으로 재초대(상향)하면 403, 초대 안 함', async () => {
  ;(requireAal2 as jest.Mock).mockResolvedValue(new Response(null, { status: 403 }))
  expect((await post({ email: 'invitee@example.com', role: 'ADMIN' })).status).toBe(403)
  expect(createInvitation).not.toHaveBeenCalled()
})

it('AAL1 로 대기 ADMIN 초대를 MEMBER 로 재초대(하향)하면 200, 역할 MEMBER·aal1', async () => {
  ;(requireAal2 as jest.Mock).mockResolvedValue(new Response(null, { status: 403 }))
  ;(isAal2Fresh as jest.Mock).mockResolvedValue(false)
  ;(createInvitation as jest.Mock).mockResolvedValue({
    invitation: {
      id: 'inv-0',
      email: 'invitee@example.com',
      role: 'MEMBER',
      expiresAt: new Date(),
    },
    token: 'T3',
    converted: false,
    resent: true,
  })
  const res = await post({ email: 'invitee@example.com', role: 'MEMBER' })
  expect(res.status).toBe(200)
  expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ role: 'MEMBER' }))
  expect(writeAuditLog).toHaveBeenCalledWith(
    'u-owner',
    'space.invitation.resend',
    'space_invitation',
    'inv-0',
    expect.objectContaining({ role: 'MEMBER', aal: 'aal1' })
  )
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
    invitationId: 'inv-1',
    spaceId: 'sp-1',
    inviterId: 'u-owner',
    role: 'ADMIN',
    expiresAt: new Date('2026-10-22T00:00:00Z'),
  })
  expect(recordSendResult).toHaveBeenCalledWith('inv-1', true)
  expect(JSON.stringify((writeAuditLog as jest.Mock).mock.calls)).not.toContain('TOKEN123')
  expect(writeAuditLog).toHaveBeenCalledWith(
    'u-owner',
    'space.invitation.create',
    'space_invitation',
    'inv-1',
    { spaceId: 'sp-1', email: 'invitee@example.com', role: 'ADMIN', aal: 'aal2' }
  )
})

it('메일 발송 실패면 초대는 유지하고 emailSent:false·링크, 실패를 기록', async () => {
  ;(sendInviteEmail as jest.Mock).mockResolvedValue({ sent: false, reason: 'send_failed' })
  const body = await (await post({ email: 'invitee@example.com', role: 'MEMBER' })).json()
  expect(body).toMatchObject({
    emailSent: false,
    emailSkipReason: 'send_failed',
    link: 'https://app.example.com/invite/TOKEN123',
    resent: false,
  })
  expect(recordSendResult).toHaveBeenCalledWith('inv-1', false)
})

it('대기 초대 재초대(resent)면 200, resend 감사 로그', async () => {
  ;(createInvitation as jest.Mock).mockResolvedValue({
    invitation: {
      id: 'inv-0',
      email: 'invitee@example.com',
      role: 'MEMBER',
      expiresAt: new Date(),
    },
    token: 'T9',
    converted: false,
    resent: true,
  })
  const res = await post({ email: 'invitee@example.com', role: 'MEMBER' })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ resent: true, invitationId: 'inv-0' })
  expect(writeAuditLog).toHaveBeenCalledWith(
    'u-owner',
    'space.invitation.resend',
    'space_invitation',
    'inv-0',
    expect.objectContaining({ spaceId: 'sp-1' })
  )
})

it('기록 실패가 응답을 막지 않는다', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  ;(recordSendResult as jest.Mock).mockRejectedValueOnce(new Error('db'))
  expect((await post({ email: 'invitee@example.com', role: 'MEMBER' })).status).toBe(201)
})

it('도메인 오류는 상태 코드와 메시지로', async () => {
  ;(createInvitation as jest.Mock).mockRejectedValue(new InvitationError(409, 'already_member'))
  const res = await post({ email: 'invitee@example.com', role: 'ADMIN' })
  expect(res.status).toBe(409)
  expect((await res.json()).message).toBe('이미 이 작업 공간의 구성원입니다')
})

it('GET은 OWNER 만(MFA 없이도 200), 목록', async () => {
  ;(requireAal2 as jest.Mock).mockResolvedValue(new Response(null, { status: 403 }))
  ;(listInvitations as jest.Mock).mockResolvedValue([{ id: 'inv-1' }])
  const res = await GET(new Request('https://app.example.com/x'), params())
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ invitations: [{ id: 'inv-1' }] })
  expect(listInvitations).toHaveBeenCalledWith('sp-1')
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
    { spaceId: 'sp-1', aal: 'aal2' }
  )
})

it('DELETE: AAL1 이어도 취소 성공(역할 무관), 감사 로그에 aal1', async () => {
  ;(requireAal2 as jest.Mock).mockResolvedValue(new Response(null, { status: 403 }))
  ;(isAal2Fresh as jest.Mock).mockResolvedValue(false)
  ;(revokeInvitation as jest.Mock).mockResolvedValue(true)
  expect(
    (await DELETE(new Request('https://x', { method: 'DELETE' }), delParams('inv-1'))).status
  ).toBe(200)
  expect(requireAal2).not.toHaveBeenCalled()
  expect(writeAuditLog).toHaveBeenCalledWith(
    'u-owner',
    'space.invitation.revoke',
    'space_invitation',
    'inv-1',
    { spaceId: 'sp-1', aal: 'aal1' }
  )
})

it('감사 로그 실패 시 메일을 보내지 않는다', async () => {
  ;(writeAuditLog as jest.Mock).mockRejectedValueOnce(new Error('db down'))
  await expect(post({ email: 'invitee@example.com', role: 'ADMIN' })).rejects.toThrow('db down')
  expect(sendInviteEmail).not.toHaveBeenCalled()
})

describe('resend', () => {
  const resend = () => RESEND(new Request('https://x', { method: 'POST' }), delParams('inv-1'))
  beforeEach(() => {
    ;(resendInvitation as jest.Mock).mockResolvedValue({
      invitation: {
        id: 'inv-1',
        email: 'invitee@example.com',
        role: 'ADMIN',
        expiresAt: new Date('2026-11-22T00:00:00Z'),
      },
      token: 'NEWTOK',
    })
  })
  it('OWNER 면 AAL2 없이도 새 링크·메일·기록·감사 로그', async () => {
    ;(requireAal2 as jest.Mock).mockResolvedValue(new Response(null, { status: 403 }))
    const res = await resend()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      link: 'https://app.example.com/invite/NEWTOK',
      emailSent: true,
      expiresAt: '2026-11-22T00:00:00.000Z',
    })
    expect(resendInvitation).toHaveBeenCalledWith('sp-1', 'inv-1')
    expect(sendInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ invitePath: '/invite/NEWTOK', inviterId: 'u-owner', role: 'ADMIN' })
    )
    expect(recordSendResult).toHaveBeenCalledWith('inv-1', true)
    expect(writeAuditLog).toHaveBeenCalledWith(
      'u-owner',
      'space.invitation.resend',
      'space_invitation',
      'inv-1',
      { spaceId: 'sp-1' }
    )
    expect(JSON.stringify((writeAuditLog as jest.Mock).mock.calls)).not.toContain('NEWTOK')
  })
  it('OWNER 가 아니면 403, 아무것도 안 함', async () => {
    ;(requireSpaceOwner as jest.Mock).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    })
    expect((await resend()).status).toBe(403)
    expect(resendInvitation).not.toHaveBeenCalled()
  })
  it.each([
    [404, 'not_found'],
    [429, 'resend_cooldown'],
    [429, 'resend_limit'],
  ] as const)('도메인 오류 %s %s', async (status, reason) => {
    ;(resendInvitation as jest.Mock).mockRejectedValue(new InvitationError(status, reason))
    const res = await resend()
    expect(res.status).toBe(status)
    expect((await res.json()).reason).toBe(reason)
    expect(sendInviteEmail).not.toHaveBeenCalled()
  })
  it('메일 실패면 emailSent:false + 링크, 실패 기록', async () => {
    ;(sendInviteEmail as jest.Mock).mockResolvedValue({ sent: false, reason: 'send_failed' })
    const body = await (await resend()).json()
    expect(body).toMatchObject({
      emailSent: false,
      emailSkipReason: 'send_failed',
      link: 'https://app.example.com/invite/NEWTOK',
    })
    expect(recordSendResult).toHaveBeenCalledWith('inv-1', false)
  })
})

it('GET은 OWNER 가 아니면 403, 목록 조회 안 함', async () => {
  ;(requireSpaceOwner as jest.Mock).mockResolvedValue({
    error: new Response(null, { status: 403 }),
  })
  expect((await GET(new Request('https://x'), params())).status).toBe(403)
  expect(listInvitations).not.toHaveBeenCalled()
})

describe('DELETE guard 거부: OWNER 아님', () => {
  beforeEach(() =>
    (requireSpaceOwner as jest.Mock).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    })
  )
  it('DELETE는 403, 취소 안 함', async () => {
    expect(
      (await DELETE(new Request('https://x', { method: 'DELETE' }), delParams('inv-1'))).status
    ).toBe(403)
    expect(revokeInvitation).not.toHaveBeenCalled()
    expect(writeAuditLog).not.toHaveBeenCalled()
  })
})
