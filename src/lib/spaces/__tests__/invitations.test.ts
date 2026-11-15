/** @jest-environment node */
jest.mock('@/lib/prisma', () => {
  const p = {
    space: { findUnique: jest.fn(), updateMany: jest.fn() },
    spaceMember: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    spaceInvitation: {
      count: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
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
  findInvitationByToken,
  hashInviteToken,
  invitationState,
  listInvitations,
  maskEmail,
  normalizeEmail,
  recordSendResult,
  resendInvitation,
} from '../invitations'

const m = prisma as unknown as {
  space: { findUnique: jest.Mock; updateMany: jest.Mock }
  spaceMember: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock }
  spaceInvitation: {
    count: jest.Mock
    updateMany: jest.Mock
    create: jest.Mock
    findUnique: jest.Mock
    findFirst: jest.Mock
    findMany: jest.Mock
    update: jest.Mock
  }
  user: { upsert: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock }
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
  m.spaceInvitation.findFirst.mockResolvedValue(null)
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
  it('정규화한 이메일로 만들고, 토큰 원문은 저장하지 않는다', async () => {
    const r = await createInvitation({
      spaceId: 'sp-1',
      email: ' Invitee@Example.com',
      role: 'ADMIN',
      invitedById: 'u-owner',
    })
    expect(m.spaceInvitation.updateMany).not.toHaveBeenCalled()
    expect(r.resent).toBe(false)
    const data = m.spaceInvitation.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      spaceId: 'sp-1',
      email: 'invitee@example.com',
      role: 'ADMIN',
      invitedById: 'u-owner',
      sendCount: 0,
      lastSentAt: expect.any(Date),
    })
    expect(data.tokenHash).toBe(hashInviteToken(r.token))
    expect(JSON.stringify(data)).not.toContain(r.token)
    expect(r.token.length).toBeGreaterThanOrEqual(43)
  })
  it('개인 Space의 첫 초대는 팀 Space로 전환하고 초대를 만든다', async () => {
    m.space.findUnique.mockResolvedValue({ id: 'sp-1', type: 'PERSONAL' })
    m.space.updateMany.mockResolvedValue({ count: 1 })
    const r = await createInvitation({
      spaceId: 'sp-1',
      email: 'a@b.com',
      role: 'MEMBER',
      invitedById: 'u',
    })
    expect(m.space.updateMany).toHaveBeenCalledWith({
      where: { id: 'sp-1', type: 'PERSONAL' },
      data: { type: 'ORGANIZATION' },
    })
    expect(r.converted).toBe(true)
    expect(m.spaceInvitation.create).toHaveBeenCalled()
  })
  it('초대 생성이 실패하면 개인 Space를 전환하지 않는다', async () => {
    m.space.findUnique.mockResolvedValue({ id: 'sp-1', type: 'PERSONAL' })
    m.spaceInvitation.create.mockRejectedValueOnce(new Error('db down'))
    await expect(
      createInvitation({ spaceId: 'sp-1', email: 'a@b.com', role: 'MEMBER', invitedById: 'u' })
    ).rejects.toThrow('db down')
    expect(m.space.updateMany).not.toHaveBeenCalled()
  })
  it('팀 Space는 전환하지 않는다', async () => {
    const r = await createInvitation({
      spaceId: 'sp-1',
      email: 'a@b.com',
      role: 'MEMBER',
      invitedById: 'u',
    })
    expect(m.space.updateMany).not.toHaveBeenCalled()
    expect(r.converted).toBe(false)
  })
  it('이미 구성원이면 개인 Space여도 전환하지 않는다', async () => {
    m.space.findUnique.mockResolvedValue({ id: 'sp-1', type: 'PERSONAL' })
    m.spaceMember.findFirst.mockResolvedValue({ id: 'mem' })
    await expect(
      createInvitation({ spaceId: 'sp-1', email: 'a@b.com', role: 'MEMBER', invitedById: 'u' })
    ).rejects.toMatchObject({ status: 409 })
    expect(m.space.updateMany).not.toHaveBeenCalled()
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
      create: {
        id: 'u-1',
        email: 'invitee@example.com',
        name: '초대받은 사람',
        signupSource: { utm_source: 'invite' },
      },
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
    m.spaceInvitation.findUnique
      .mockResolvedValueOnce(inv)
      .mockResolvedValueOnce({ ...inv, acceptedAt: new Date() })
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

describe('acceptInvitation 재발급·역할 갱신 경합', () => {
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
    m.spaceMember.findUnique.mockResolvedValue(null)
  })
  it('수락 조건에 읽은 tokenHash·role 이 들어간다', async () => {
    m.spaceInvitation.findUnique.mockResolvedValue(inv)
    await acceptInvitation({ token: 't', user: user() })
    expect(m.spaceInvitation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'inv-1',
        tokenHash: hashInviteToken('t'),
        role: 'ADMIN',
      }),
      data: expect.any(Object),
    })
  })
  it('재발급이 끼어들어 0건이면 not_found 404, 구성원은 만들지 않는다', async () => {
    m.spaceInvitation.findUnique.mockResolvedValueOnce(inv).mockResolvedValueOnce(null)
    m.spaceInvitation.updateMany.mockResolvedValue({ count: 0 })
    await expect(acceptInvitation({ token: 't', user: user() })).rejects.toMatchObject({
      status: 404,
      reason: 'not_found',
    })
    expect(m.spaceMember.create).not.toHaveBeenCalled()
  })
  it('역할이 바뀌어 0건이면(같은 토큰 아직 대기) not_found', async () => {
    m.spaceInvitation.findUnique.mockResolvedValueOnce(inv).mockResolvedValueOnce({
      ...inv,
      role: 'MEMBER',
    })
    m.spaceInvitation.updateMany.mockResolvedValue({ count: 0 })
    await expect(acceptInvitation({ token: 't', user: user() })).rejects.toMatchObject({
      status: 404,
      reason: 'not_found',
    })
    expect(m.spaceMember.create).not.toHaveBeenCalled()
  })
})

describe('resendInvitation', () => {
  const sentAt = new Date(Date.now() - 5 * 60_000)
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    email: 'invitee@example.com',
    role: 'ADMIN',
    lastSentAt: sentAt,
    createdAt: sentAt,
    sendCount: 1,
    ...over,
  })
  it('토큰을 재발급하고 만료를 7일 재시작, 조건부(lastSentAt 일치)로 기록한다', async () => {
    m.spaceInvitation.findFirst.mockResolvedValue(row())
    const r = await resendInvitation('sp-1', 'inv-1')
    expect(m.spaceInvitation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'inv-1', spaceId: 'sp-1', lastSentAt: sentAt }),
      data: {
        tokenHash: hashInviteToken(r.token),
        expiresAt: expect.any(Date),
        lastSentAt: expect.any(Date),
      },
    })
    const data = m.spaceInvitation.updateMany.mock.calls[0][0].data
    expect(data.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000)
    expect(r.invitation).toMatchObject({ id: 'inv-1', email: 'invitee@example.com', role: 'ADMIN' })
    expect(r.token.length).toBeGreaterThanOrEqual(43)
  })
  it('역할을 주면 같이 갱신한다', async () => {
    m.spaceInvitation.findFirst.mockResolvedValue(row())
    const r = await resendInvitation('sp-1', 'inv-1', { role: 'MEMBER' })
    expect(m.spaceInvitation.updateMany.mock.calls[0][0].data.role).toBe('MEMBER')
    expect(r.invitation.role).toBe('MEMBER')
  })
  it('대기 초대가 아니면 404', async () => {
    m.spaceInvitation.findFirst.mockResolvedValue(null)
    await expect(resendInvitation('sp-1', 'x')).rejects.toMatchObject({
      status: 404,
      reason: 'not_found',
    })
  })
  it('1분 안이면 429 resend_cooldown', async () => {
    m.spaceInvitation.findFirst.mockResolvedValue(
      row({ lastSentAt: new Date(Date.now() - 30_000) })
    )
    await expect(resendInvitation('sp-1', 'inv-1')).rejects.toMatchObject({
      status: 429,
      reason: 'resend_cooldown',
    })
    expect(m.spaceInvitation.updateMany).not.toHaveBeenCalled()
  })
  it('lastSentAt 이 없으면 createdAt 으로 쿨다운을 본다', async () => {
    m.spaceInvitation.findFirst.mockResolvedValue(row({ lastSentAt: null, createdAt: new Date() }))
    await expect(resendInvitation('sp-1', 'inv-1')).rejects.toMatchObject({
      reason: 'resend_cooldown',
    })
  })
  it('발송 성공 6회(최초 1+다시 5)면 429 resend_limit, 5회는 통과', async () => {
    m.spaceInvitation.findFirst.mockResolvedValue(row({ sendCount: 6 }))
    await expect(resendInvitation('sp-1', 'inv-1')).rejects.toMatchObject({
      status: 429,
      reason: 'resend_limit',
    })
    m.spaceInvitation.findFirst.mockResolvedValue(row({ sendCount: 5 }))
    await expect(resendInvitation('sp-1', 'inv-1')).resolves.toBeDefined()
  })
  it('동시 클릭에서 진 쪽(조건부 갱신 0건)은 429 resend_cooldown', async () => {
    m.spaceInvitation.findFirst.mockResolvedValue(row())
    m.spaceInvitation.updateMany.mockResolvedValue({ count: 0 })
    await expect(resendInvitation('sp-1', 'inv-1')).rejects.toMatchObject({
      status: 429,
      reason: 'resend_cooldown',
    })
  })
  it('갱신 0건인데 그 사이 수락됐으면 410 accepted(쿨다운 문구 아님)', async () => {
    m.spaceInvitation.findFirst
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ acceptedAt: new Date() }))
    m.spaceInvitation.updateMany.mockResolvedValue({ count: 0 })
    await expect(resendInvitation('sp-1', 'inv-1')).rejects.toMatchObject({
      status: 410,
      reason: 'accepted',
    })
  })
})

describe('createInvitation 대기 초대 재초대', () => {
  it('같은 이메일 대기 초대가 있으면 새 행 없이 그 행을 다시 보내고(역할 갱신) resent:true', async () => {
    const sentAt = new Date(Date.now() - 5 * 60_000)
    m.spaceInvitation.findFirst.mockResolvedValue({
      id: 'inv-0',
      email: 'invitee@example.com',
      role: 'MEMBER',
      lastSentAt: sentAt,
      createdAt: sentAt,
      sendCount: 1,
    })
    const r = await createInvitation({
      spaceId: 'sp-1',
      email: 'Invitee@Example.com',
      role: 'ADMIN',
      invitedById: 'u',
    })
    expect(m.spaceInvitation.create).not.toHaveBeenCalled()
    expect(r.resent).toBe(true)
    expect(r.converted).toBe(false)
    expect(r.invitation).toMatchObject({ id: 'inv-0', role: 'ADMIN' })
    expect(m.spaceInvitation.updateMany.mock.calls[0][0].data.role).toBe('ADMIN')
  })
  it('쿨다운 중 재초대는 429 resend_cooldown', async () => {
    m.spaceInvitation.findFirst.mockResolvedValue({
      id: 'inv-0',
      email: 'invitee@example.com',
      role: 'MEMBER',
      lastSentAt: new Date(),
      createdAt: new Date(),
      sendCount: 1,
    })
    await expect(
      createInvitation({
        spaceId: 'sp-1',
        email: 'invitee@example.com',
        role: 'MEMBER',
        invitedById: 'u',
      })
    ).rejects.toMatchObject({ status: 429, reason: 'resend_cooldown' })
  })
})

describe('recordSendResult', () => {
  it('성공이면 sendCount +1·lastSendFailed false', async () => {
    await recordSendResult('inv-1', true)
    expect(m.spaceInvitation.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { sendCount: { increment: 1 }, lastSendFailed: false },
    })
  })
  it('실패면 lastSendFailed true 만', async () => {
    await recordSendResult('inv-1', false)
    expect(m.spaceInvitation.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { lastSendFailed: true },
    })
  })
})

describe('listInvitations', () => {
  const day = 86_400_000
  const base = {
    role: 'MEMBER',
    createdAt: new Date(),
    invitedById: 'u1',
    lastSentAt: null,
    sendCount: 1,
    lastSendFailed: false,
    acceptedAt: null,
    revokedAt: null,
  }
  it('대기 전부와 최근 30일 내 종결 건만, 상태·초대자 이름 포함', async () => {
    m.spaceInvitation.findMany.mockResolvedValue([
      { ...base, id: 'p', email: 'p@x.com', expiresAt: new Date(Date.now() + day) },
      {
        ...base,
        id: 'a',
        email: 'a@x.com',
        expiresAt: new Date(Date.now() + day),
        acceptedAt: new Date(Date.now() - 2 * day),
      },
      { ...base, id: 'old', email: 'o@x.com', expiresAt: new Date(Date.now() - 40 * day) },
      { ...base, id: 'e', email: 'e@x.com', expiresAt: new Date(Date.now() - 2 * day) },
      {
        ...base,
        id: 'r',
        email: 'r@x.com',
        expiresAt: new Date(Date.now() + day),
        revokedAt: new Date(Date.now() - day),
      },
      {
        ...base,
        id: 'oldr',
        email: 'or@x.com',
        expiresAt: new Date(Date.now() + day),
        revokedAt: new Date(Date.now() - 31 * day),
      },
    ])
    m.user.findMany.mockResolvedValue([{ id: 'u1', name: '소유자', email: 'o@x.com' }])
    const list = await listInvitations('sp-1')
    expect(list.map((i) => [i.id, i.state])).toEqual([
      ['p', 'pending'],
      ['a', 'accepted'],
      ['e', 'expired'],
      ['r', 'revoked'],
    ])
    expect(list[0]).toMatchObject({
      invitedByName: '소유자',
      sendCount: 1,
      lastSendFailed: false,
    })
    expect(list[0]).not.toHaveProperty('invitedById')
  })
})

describe('이전 토큰 무효', () => {
  it('재발급 후 이전 토큰으로는 findInvitationByToken 이 null(tokenHash 가 바뀜)', async () => {
    m.spaceInvitation.findFirst.mockResolvedValue({
      id: 'inv-1',
      email: 'a@b.com',
      role: 'ADMIN',
      lastSentAt: new Date(Date.now() - 600_000),
      createdAt: new Date(Date.now() - 600_000),
      sendCount: 1,
    })
    const r = await resendInvitation('sp-1', 'inv-1')
    const newHash = m.spaceInvitation.updateMany.mock.calls[0][0].data.tokenHash
    expect(newHash).toBe(hashInviteToken(r.token))
    expect(newHash).not.toBe(hashInviteToken('old-token'))
  })
})

describe('findInvitationByToken', () => {
  const inv = {
    id: 'i1',
    spaceId: 's1',
    email: 'a@b.com',
    role: 'MEMBER',
    invitedById: 'u1',
    expiresAt: new Date(),
    acceptedAt: null,
    revokedAt: null,
    space: { name: 'S' },
  }

  it('초대자 이름이 없으면 마스킹된 이메일로 대체(원문 노출 금지)', async () => {
    m.spaceInvitation.findUnique.mockResolvedValue(inv)
    m.user.findUnique.mockResolvedValue({ name: null, email: 'inviter@example.com' })
    const r = await findInvitationByToken('tok')
    expect(r?.invitedByName).toBe(maskEmail('inviter@example.com'))
    expect(r?.invitedByName).not.toContain('inviter@example.com')
  })

  it('초대자 이름이 있으면 이름 사용', async () => {
    m.spaceInvitation.findUnique.mockResolvedValue(inv)
    m.user.findUnique.mockResolvedValue({ name: '소유자', email: 'x@y.com' })
    expect((await findInvitationByToken('tok'))?.invitedByName).toBe('소유자')
  })
})
