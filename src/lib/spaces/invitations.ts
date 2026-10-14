import 'server-only'
import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'

export const INVITE_TTL_DAYS = 7
export const MAX_PENDING_INVITES = 20

type Reason =
  | 'not_found'
  | 'expired'
  | 'revoked'
  | 'accepted'
  | 'email_mismatch'
  | 'email_unverified'
  | 'personal_space'
  | 'already_member'
  | 'too_many'

const MESSAGES: Record<Reason, string> = {
  not_found: '초대를 찾을 수 없습니다',
  expired: '초대가 만료되었습니다. 초대한 분께 다시 요청하세요',
  revoked: '취소된 초대입니다',
  accepted: '이미 사용한 초대입니다',
  email_mismatch: '초대받은 이메일 계정으로 로그인하세요',
  email_unverified: '이메일 인증을 마친 뒤 수락하세요',
  personal_space: '개인 Space에는 초대할 수 없습니다',
  already_member: '이미 이 Space의 구성원입니다',
  too_many: '대기 중인 초대가 너무 많습니다. 쓰지 않는 초대를 취소하세요',
}

export class InvitationError extends Error {
  constructor(
    public status: number,
    public reason: Reason
  ) {
    super(MESSAGES[reason])
    this.name = 'InvitationError'
  }
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  return `${local.slice(0, 2)}***@${domain ?? ''}`
}

export function invitationState(
  inv: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null },
  now: Date = new Date()
): 'pending' | 'expired' | 'revoked' | 'accepted' {
  if (inv.acceptedAt) return 'accepted'
  if (inv.revokedAt) return 'revoked'
  if (inv.expiresAt <= now) return 'expired'
  return 'pending'
}

const pendingWhere = (now: Date) => ({ acceptedAt: null, revokedAt: null, expiresAt: { gt: now } })

export async function createInvitation(input: {
  spaceId: string
  email: string
  role: 'ADMIN' | 'MEMBER'
  invitedById: string
}) {
  // 타입 밖 입력(API 본문 등)이 OWNER를 만들지 못하게 런타임에서도 막는다.
  if (input.role !== 'ADMIN' && input.role !== 'MEMBER') throw new Error('invalid role')
  const email = normalizeEmail(input.email)
  const now = new Date()
  const space = await prisma.space.findUnique({
    where: { id: input.spaceId },
    select: { id: true, type: true },
  })
  if (!space) throw new InvitationError(404, 'not_found')
  if (space.type === 'PERSONAL') throw new InvitationError(400, 'personal_space')

  const member = await prisma.spaceMember.findFirst({
    where: { spaceId: input.spaceId, user: { email: { equals: email, mode: 'insensitive' } } },
    select: { id: true },
  })
  if (member) throw new InvitationError(409, 'already_member')

  const pending = await prisma.spaceInvitation.count({
    // 같은 이메일 재초대는 이전 대기 초대를 닫으므로 대기 수가 늘지 않는다 — 상한에서 뺀다.
    where: { spaceId: input.spaceId, email: { not: email }, ...pendingWhere(now) },
  })
  if (pending >= MAX_PENDING_INVITES) throw new InvitationError(429, 'too_many')

  // 같은 이메일의 이전 대기 초대는 닫는다 — 대기 초대는 하나만.
  await prisma.spaceInvitation.updateMany({
    where: { spaceId: input.spaceId, email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: now },
  })

  const token = randomBytes(32).toString('base64url')
  const invitation = await prisma.spaceInvitation.create({
    data: {
      spaceId: input.spaceId,
      email,
      role: input.role,
      tokenHash: hashInviteToken(token),
      invitedById: input.invitedById,
      expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000),
    },
    select: { id: true, email: true, role: true, expiresAt: true },
  })
  return {
    invitation: invitation as {
      id: string
      email: string
      role: 'ADMIN' | 'MEMBER'
      expiresAt: Date
    },
    token,
  }
}

export async function findInvitationByToken(token: string) {
  const inv = await prisma.spaceInvitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      id: true,
      spaceId: true,
      email: true,
      role: true,
      invitedById: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      space: { select: { name: true } },
    },
  })
  if (!inv) return null
  const inviter = await prisma.user.findUnique({
    where: { id: inv.invitedById },
    select: { name: true, email: true },
  })
  return {
    id: inv.id,
    spaceId: inv.spaceId,
    spaceName: inv.space.name,
    email: inv.email,
    role: inv.role as 'ADMIN' | 'MEMBER',
    invitedByName: inviter?.name ?? inviter?.email ?? null,
    expiresAt: inv.expiresAt,
    acceptedAt: inv.acceptedAt,
    revokedAt: inv.revokedAt,
  }
}

export async function acceptInvitation(input: {
  token: string
  user: {
    id: string
    email: string | null | undefined
    emailConfirmed: boolean
    name: string | null
  }
}): Promise<{ spaceId: string; invitationId: string }> {
  const inv = await prisma.spaceInvitation.findUnique({
    where: { tokenHash: hashInviteToken(input.token) },
    select: {
      id: true,
      spaceId: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
    },
  })
  if (!inv) throw new InvitationError(404, 'not_found')
  const state = invitationState(inv)
  if (state !== 'pending') throw new InvitationError(410, state)
  if (!input.user.email || normalizeEmail(input.user.email) !== inv.email) {
    throw new InvitationError(403, 'email_mismatch')
  }
  if (!input.user.emailConfirmed) throw new InvitationError(403, 'email_unverified')

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    // 조건부 update로 한 번만 수락된다(동시 수락은 count 0 → 410).
    const claimed = await tx.spaceInvitation.updateMany({
      where: { id: inv.id, ...pendingWhere(now) },
      data: { acceptedAt: now, acceptedUserId: input.user.id },
    })
    if (claimed.count !== 1) throw new InvitationError(410, 'accepted')
    await tx.user.upsert({
      where: { id: input.user.id },
      create: { id: input.user.id, email: inv.email, name: input.user.name },
      update: {},
    })
    const existing = await tx.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: inv.spaceId, userId: input.user.id } },
      select: { id: true },
    })
    // 이미 구성원이면 역할을 바꾸지 않는다.
    if (!existing) {
      await tx.spaceMember.create({
        data: { spaceId: inv.spaceId, userId: input.user.id, role: inv.role },
      })
    }
  })
  return { spaceId: inv.spaceId, invitationId: inv.id }
}

export async function listPendingInvitations(spaceId: string) {
  const rows = await prisma.spaceInvitation.findMany({
    where: { spaceId, ...pendingWhere(new Date()) },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      invitedById: true,
    },
  })
  const inviters = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.invitedById))] } },
    select: { id: true, name: true, email: true },
  })
  const nameOf = new Map(inviters.map((u) => [u.id, u.name ?? u.email]))
  return rows.map(({ invitedById, ...r }) => ({
    ...r,
    invitedByName: nameOf.get(invitedById) ?? null,
  }))
}

export async function revokeInvitation(spaceId: string, invitationId: string): Promise<boolean> {
  const r = await prisma.spaceInvitation.updateMany({
    where: { id: invitationId, spaceId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return r.count === 1
}
