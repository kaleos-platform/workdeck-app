/** @jest-environment node */
jest.mock('@/lib/admin/auth', () => ({ requireOperator: jest.fn(), writeAuditLog: jest.fn() }))
jest.mock('@/lib/domain', () => ({ getAppOrigin: () => 'https://app.example.com' }))
jest.mock('@/lib/spaces/invite-email', () => ({ sendInviteEmail: jest.fn() }))
jest.mock('@/lib/spaces/invitations', () => {
  const actual = jest.requireActual('@/lib/spaces/invitations')
  return {
    ...actual,
    listInvitations: jest.fn(),
    resendInvitation: jest.fn(),
    recordSendResult: jest.fn(),
  }
})

import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { sendInviteEmail } from '@/lib/spaces/invite-email'
import {
  InvitationError,
  listInvitations,
  recordSendResult,
  resendInvitation,
} from '@/lib/spaces/invitations'
import { GET } from '../route'
import { POST } from '../[invitationId]/resend/route'

const ctx = { params: Promise.resolve({ spaceId: 'sp-1', invitationId: 'inv-1' }) }
const resend = () => POST(new Request('https://x', { method: 'POST' }), ctx)
const denied = (status: number) => ({ ok: false, response: new Response(null, { status }) })

beforeEach(() => {
  jest.resetAllMocks()
  ;(requireOperator as jest.Mock).mockResolvedValue({
    ok: true,
    user: { id: 'op-1', email: 'o@x' },
  })
  ;(resendInvitation as jest.Mock).mockResolvedValue({
    invitation: {
      id: 'inv-1',
      email: 'invitee@example.com',
      role: 'ADMIN',
      expiresAt: new Date('2026-12-02T00:00:00Z'),
      invitedById: 'u-owner',
    },
    token: 'NEWTOK',
  })
  ;(sendInviteEmail as jest.Mock).mockResolvedValue({ sent: true, via: 'supabase' })
})

describe('GET', () => {
  it.each([404, 403])('운영자 게이트 거부 %s 면 조회 안 함', async (status) => {
    ;(requireOperator as jest.Mock).mockResolvedValue(denied(status))
    const res = await GET(new Request('https://x'), ctx)
    expect(res.status).toBe(status)
    expect(listInvitations).not.toHaveBeenCalled()
  })
  it('운영자면 목록', async () => {
    ;(listInvitations as jest.Mock).mockResolvedValue([{ id: 'inv-1' }])
    const res = await GET(new Request('https://x'), ctx)
    expect(await res.json()).toEqual({ invitations: [{ id: 'inv-1' }] })
    expect(listInvitations).toHaveBeenCalledWith('sp-1')
  })
})

describe('POST resend', () => {
  it.each([404, 403])('운영자 게이트 거부 %s 면 아무것도 안 함', async (status) => {
    ;(requireOperator as jest.Mock).mockResolvedValue(denied(status))
    expect((await resend()).status).toBe(status)
    expect(writeAuditLog).not.toHaveBeenCalled()
    expect(resendInvitation).not.toHaveBeenCalled()
  })
  it('감사 로그 → 상한 무시 재발급 → 원 초대자로 메일 → 기록, 링크 반환', async () => {
    const order: string[] = []
    ;(writeAuditLog as jest.Mock).mockImplementation(async () => void order.push('audit'))
    ;(resendInvitation as jest.Mock).mockImplementation(async () => {
      order.push('resend')
      return {
        invitation: {
          id: 'inv-1',
          email: 'invitee@example.com',
          role: 'ADMIN',
          expiresAt: new Date('2026-12-02T00:00:00Z'),
          invitedById: 'u-owner',
        },
        token: 'NEWTOK',
      }
    })
    const res = await resend()
    expect(await res.json()).toMatchObject({
      link: 'https://app.example.com/invite/NEWTOK',
      emailSent: true,
      expiresAt: '2026-12-02T00:00:00.000Z',
    })
    expect(order).toEqual(['audit', 'resend'])
    expect(writeAuditLog).toHaveBeenCalledWith(
      'op-1',
      'space.invitation.operator_resend',
      'space_invitation',
      'inv-1',
      { spaceId: 'sp-1' }
    )
    expect(resendInvitation).toHaveBeenCalledWith('sp-1', 'inv-1', { ignoreSendLimit: true })
    expect(sendInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ inviterId: 'u-owner', invitePath: '/invite/NEWTOK' })
    )
    expect(recordSendResult).toHaveBeenCalledWith('inv-1', true)
    expect(JSON.stringify((writeAuditLog as jest.Mock).mock.calls)).not.toContain('NEWTOK')
  })
  it('감사 로그 실패 시 토큰을 바꾸지 않는다', async () => {
    ;(writeAuditLog as jest.Mock).mockRejectedValue(new Error('db down'))
    await expect(resend()).rejects.toThrow('db down')
    expect(resendInvitation).not.toHaveBeenCalled()
    expect(sendInviteEmail).not.toHaveBeenCalled()
  })
  it.each([
    [404, 'not_found'],
    [429, 'resend_cooldown'],
  ] as const)('도메인 오류 %s %s', async (status, reason) => {
    ;(resendInvitation as jest.Mock).mockRejectedValue(new InvitationError(status, reason))
    const res = await resend()
    expect(res.status).toBe(status)
    expect((await res.json()).reason).toBe(reason)
    expect(sendInviteEmail).not.toHaveBeenCalled()
  })
  it('메일 실패면 emailSent:false + 링크', async () => {
    ;(sendInviteEmail as jest.Mock).mockResolvedValue({ sent: false, reason: 'send_failed' })
    expect(await (await resend()).json()).toMatchObject({
      emailSent: false,
      emailSkipReason: 'send_failed',
      link: 'https://app.example.com/invite/NEWTOK',
    })
    expect(recordSendResult).toHaveBeenCalledWith('inv-1', false)
  })
})
