import { prisma } from '@/lib/prisma'
import {
  acceptInvitation,
  createInvitation,
  findInvitationByToken,
  listInvitations,
  revokeInvitation,
} from '../invitations'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip
const SP = 'e2e00000-0000-4000-8000-0000000000i1'
const OWNER = 'e2e00000-0000-4000-8000-0000000000i2'
const INVITEE = 'e2e00000-0000-4000-8000-0000000000i3'
const EMAIL = 'e2e-invitee@example.com'

d('Space 초대 (실 DB)', () => {
  beforeAll(async () => {
    await prisma.spaceInvitation.deleteMany({ where: { spaceId: SP } })
    await prisma.spaceMember.deleteMany({ where: { spaceId: SP } })
    await prisma.workspace.deleteMany({ where: { ownerId: INVITEE } })
    await prisma.user.deleteMany({ where: { id: INVITEE } })
    await prisma.space.upsert({
      where: { id: SP },
      update: {},
      create: { id: SP, name: 'E2E 초대', type: 'ORGANIZATION' },
    })
    await prisma.user.upsert({
      where: { id: OWNER },
      update: {},
      create: { id: OWNER, email: 'e2e-owner@example.com', name: '소유자' },
    })
    await prisma.spaceMember.create({ data: { spaceId: SP, userId: OWNER, role: 'OWNER' } })
  })
  afterAll(async () => {
    await prisma.spaceInvitation.deleteMany({ where: { spaceId: SP } })
    await prisma.spaceMember.deleteMany({ where: { spaceId: SP } })
    await prisma.user.deleteMany({ where: { id: { in: [INVITEE, OWNER] } } })
    await prisma.space.deleteMany({ where: { id: SP } })
    await prisma.$disconnect()
  })

  it('초대 → 조회 → 동시 수락 1건만 성공 → 구성원 생성, Workspace·PERSONAL Space 없음', async () => {
    const { token } = await createInvitation({
      spaceId: SP,
      email: EMAIL,
      role: 'ADMIN',
      invitedById: OWNER,
    })
    const found = await findInvitationByToken(token)
    expect(found).toMatchObject({ spaceName: 'E2E 초대', role: 'ADMIN', invitedByName: '소유자' })
    expect(await listInvitations(SP)).toHaveLength(1)

    const u = { id: INVITEE, email: EMAIL, emailConfirmed: true, name: null }
    const results = await Promise.allSettled([
      acceptInvitation({ token, user: u }),
      acceptInvitation({ token, user: u }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ status: 410, reason: 'accepted' })

    const mem = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: SP, userId: INVITEE } },
    })
    expect(mem?.role).toBe('ADMIN')
    expect(await prisma.workspace.count({ where: { ownerId: INVITEE } })).toBe(0)
    expect(await prisma.spaceMember.count({ where: { userId: INVITEE } })).toBe(1)
  })

  it('대기 중 재초대는 같은 행을 새 토큰으로 갱신하고 이전 토큰은 무효, 취소한 초대는 수락할 수 없다', async () => {
    const other = 'e2e-other@example.com'
    const first = await createInvitation({
      spaceId: SP,
      email: other,
      role: 'MEMBER',
      invitedById: OWNER,
    })
    // 쿨다운을 건너뛰도록 마지막 발송 시각을 과거로
    await prisma.spaceInvitation.update({
      where: { id: first.invitation.id },
      data: { lastSentAt: new Date(Date.now() - 120_000) },
    })
    const second = await createInvitation({
      spaceId: SP,
      email: other,
      role: 'ADMIN',
      invitedById: OWNER,
    })
    expect(second.resent).toBe(true)
    expect(second.invitation.id).toBe(first.invitation.id)
    expect(await findInvitationByToken(first.token)).toBeNull()
    expect((await findInvitationByToken(second.token))?.role).toBe('ADMIN')
    expect(await revokeInvitation(SP, second.invitation.id)).toBe(true)
    expect(await revokeInvitation('other-space', second.invitation.id)).toBe(false)
    await expect(
      acceptInvitation({
        token: second.token,
        user: { id: 'x', email: other, emailConfirmed: true, name: null },
      })
    ).rejects.toMatchObject({ status: 410, reason: 'revoked' })
  })
})
