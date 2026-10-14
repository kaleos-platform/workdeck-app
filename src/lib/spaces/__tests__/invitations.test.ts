/** @jest-environment node */
jest.mock('@/lib/prisma', () => {
  const p = {
    space: { findUnique: jest.fn() },
    spaceMember: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    spaceInvitation: {
      count: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    user: { upsert: jest.fn() },
    $transaction: jest.fn(),
  }
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p))
  return { prisma: p }
})

import { prisma } from '@/lib/prisma'
import {
  InvitationError,
  acceptInvitation,
  createInvitation,
  hashInviteToken,
  invitationState,
  maskEmail,
  normalizeEmail,
} from '../invitations'

const m = prisma as unknown as {
  space: { findUnique: jest.Mock }
  spaceMember: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock }
  spaceInvitation: {
    count: jest.Mock
    updateMany: jest.Mock
    create: jest.Mock
    findUnique: jest.Mock
  }
  user: { upsert: jest.Mock }
}
const future = () => new Date(Date.now() + 86_400_000)
const user = (over: Partial<{ email: string; emailConfirmed: boolean }> = {}) => ({
  id: 'u-1',
  email: 'Invitee@Example.com',
  emailConfirmed: true,
  name: '초대받은 사람',
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  m.space.findUnique.mockResolvedValue({ id: 'sp-1', type: 'ORGANIZATION' })
  m.spaceMember.findFirst.mockResolvedValue(null)
  m.spaceInvitation.count.mockResolvedValue(0)
  m.spaceInvitation.updateMany.mockResolvedValue({ count: 1 })
  m.spaceInvitation.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({ id: 'inv-1', ...data })
  )
})

describe('helpers', () => {
  it('normalizeEmail는 공백 제거·소문자', () => {
    expect(normalizeEmail('  Invitee@Example.COM ')).toBe('invitee@example.com')
  })
  it('maskEmail은 앞 2글자만 남긴다', () => {
    expect(maskEmail('invitee@example.com')).toBe('in***@example.com')
    expect(maskEmail('a@example.com')).toBe('a***@example.com')
  })
  it('hashInviteToken은 sha256 hex', () => {
    expect(hashInviteToken('abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashInviteToken('abc')).not.toBe(hashInviteToken('abd'))
  })
  it('invitationState', () => {
    const base = { expiresAt: future(), acceptedAt: null, revokedAt: null }
    expect(invitationState(base)).toBe('pending')
    expect(invitationState({ ...base, revokedAt: new Date() })).toBe('revoked')
    expect(invitationState({ ...base, acceptedAt: new Date() })).toBe('accepted')
    expect(invitationState({ ...base, expiresAt: new Date(Date.now() - 1) })).toBe('expired')
  })
})

describe('createInvitation', () => {
  it('정규화한 이메일로 만들고, 이전 대기 초대를 닫고, 토큰 원문은 저장하지 않는다', async () => {
    const r = await createInvitation({
      spaceId: 'sp-1',
      email: ' Invitee@Example.com',
      role: 'ADMIN',
      invitedById: 'u-owner',
    })
    expect(m.spaceInvitation.updateMany).toHaveBeenCalledWith({
      where: { spaceId: 'sp-1', email: 'invitee@example.com', acceptedAt: null, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
    const data = m.spaceInvitation.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      spaceId: 'sp-1',
      email: 'invitee@example.com',
      role: 'ADMIN',
      invitedById: 'u-owner',
    })
    expect(data.tokenHash).toBe(hashInviteToken(r.token))
    expect(JSON.stringify(data)).not.toContain(r.token)
    expect(r.token.length).toBeGreaterThanOrEqual(43)
  })
  it('개인 Space는 거부', async () => {
    m.space.findUnique.mockResolvedValue({ id: 'sp-1', type: 'PERSONAL' })
    await expect(
      createInvitation({ spaceId: 'sp-1', email: 'a@b.com', role: 'MEMBER', invitedById: 'u' })
    ).rejects.toMatchObject({ status: 400, reason: 'personal_space' })
  })
  it('이미 구성원이면 409', async () => {
    m.spaceMember.findFirst.mockResolvedValue({ id: 'mem' })
    await expect(
      createInvitation({ spaceId: 'sp-1', email: 'a@b.com', role: 'MEMBER', invitedById: 'u' })
    ).rejects.toMatchObject({ status: 409, reason: 'already_member' })
  })
  it('대기 20개여도 이미 대기 중인 이메일 재초대는 통과, 새 이메일은 429', async () => {
    // 대기 20개 중 하나가 invitee@example.com — 같은 이메일을 빼고 세면 19.
    m.spaceInvitation.count.mockImplementation(
      async ({ where }: { where: { email: { not: string } } }) =>
        where.email.not === 'invitee@example.com' ? 19 : 20
    )
    await expect(
      createInvitation({
        spaceId: 'sp-1',
        email: 'Invitee@Example.com',
        role: 'MEMBER',
        invitedById: 'u',
      })
    ).resolves.toMatchObject({ invitation: { email: 'invitee@example.com' } })
    await expect(
      createInvitation({
        spaceId: 'sp-1',
        email: 'new@example.com',
        role: 'MEMBER',
        invitedById: 'u',
      })
    ).rejects.toMatchObject({ status: 429, reason: 'too_many' })
  })
  it('ADMIN·MEMBER 외 역할은 거부', async () => {
    await expect(
      createInvitation({
        spaceId: 'sp-1',
        email: 'a@b.com',
        role: 'OWNER' as 'ADMIN',
        invitedById: 'u',
      })
    ).rejects.toThrow('invalid role')
    expect(m.spaceInvitation.create).not.toHaveBeenCalled()
  })
  it('대기 초대 20개 이상이면 429', async () => {
    m.spaceInvitation.count.mockResolvedValue(20)
    await expect(
      createInvitation({ spaceId: 'sp-1', email: 'a@b.com', role: 'MEMBER', invitedById: 'u' })
    ).rejects.toMatchObject({ status: 429, reason: 'too_many' })
  })
})

describe('acceptInvitation', () => {
  const inv = {
    id: 'inv-1',
    spaceId: 'sp-1',
    email: 'invitee@example.com',
    role: 'ADMIN',
    expiresAt: future(),
    acceptedAt: null,
    revokedAt: null,
  }
  beforeEach(() => {
    m.spaceInvitation.findUnique.mockResolvedValue(inv)
    m.spaceMember.findUnique.mockResolvedValue(null)
  })
  it('대소문자만 다른 이메일은 통과하고 구성원을 만든다', async () => {
    await expect(acceptInvitation({ token: 't', user: user() })).resolves.toEqual({
      spaceId: 'sp-1',
      invitationId: 'inv-1',
    })
    expect(m.spaceMember.create).toHaveBeenCalledWith({
      data: { spaceId: 'sp-1', userId: 'u-1', role: 'ADMIN' },
    })
    expect(m.user.upsert).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      create: { id: 'u-1', email: 'invitee@example.com', name: '초대받은 사람' },
      update: {},
    })
  })
  it('다른 이메일이면 403', async () => {
    await expect(
      acceptInvitation({ token: 't', user: user({ email: 'other@example.com' }) })
    ).rejects.toMatchObject({ status: 403, reason: 'email_mismatch' })
    expect(m.spaceMember.create).not.toHaveBeenCalled()
  })
  it('확인 안 된 이메일이면 403', async () => {
    await expect(
      acceptInvitation({ token: 't', user: user({ emailConfirmed: false }) })
    ).rejects.toMatchObject({ status: 403, reason: 'email_unverified' })
  })
  it('없는 토큰 404, 만료·취소·사용됨 410', async () => {
    m.spaceInvitation.findUnique.mockResolvedValueOnce(null)
    await expect(acceptInvitation({ token: 't', user: user() })).rejects.toMatchObject({
      status: 404,
      reason: 'not_found',
    })
    m.spaceInvitation.findUnique.mockResolvedValueOnce({
      ...inv,
      expiresAt: new Date(Date.now() - 1),
    })
    await expect(acceptInvitation({ token: 't', user: user() })).rejects.toMatchObject({
      status: 410,
      reason: 'expired',
    })
    m.spaceInvitation.findUnique.mockResolvedValueOnce({ ...inv, revokedAt: new Date() })
    await expect(acceptInvitation({ token: 't', user: user() })).rejects.toMatchObject({
      status: 410,
      reason: 'revoked',
    })
    m.spaceInvitation.findUnique.mockResolvedValueOnce({ ...inv, acceptedAt: new Date() })
    await expect(acceptInvitation({ token: 't', user: user() })).rejects.toMatchObject({
      status: 410,
      reason: 'accepted',
    })
  })
  it('동시 수락에서 진 쪽은 410 accepted', async () => {
    m.spaceInvitation.updateMany.mockResolvedValue({ count: 0 })
    await expect(acceptInvitation({ token: 't', user: user() })).rejects.toMatchObject({
      status: 410,
      reason: 'accepted',
    })
    expect(m.spaceMember.create).not.toHaveBeenCalled()
  })
  it('이미 구성원이면 역할을 바꾸지 않고 통과', async () => {
    m.spaceMember.findUnique.mockResolvedValue({ id: 'mem', role: 'MEMBER' })
    await expect(acceptInvitation({ token: 't', user: user() })).resolves.toEqual({
      spaceId: 'sp-1',
      invitationId: 'inv-1',
    })
    expect(m.spaceMember.create).not.toHaveBeenCalled()
  })
  it('InvitationError는 Error다', () => {
    expect(new InvitationError(404, 'not_found')).toBeInstanceOf(Error)
  })
})
