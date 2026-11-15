import 'server-only'
import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'

export const INVITE_TTL_DAYS = 7
export const MAX_PENDING_INVITES = 20
export const RESEND_COOLDOWN_MS = 60_000
// 발송 성공 횟수 상한 — 최초 1 + 다시 보내기 5
export const MAX_SEND_COUNT = 6
const RECENT_DAYS = 30

type Reason =
  | 'not_found'
  | 'expired'
  | 'revoked'
  | 'accepted'
  | 'email_mismatch'
  | 'email_unverified'
  | 'already_member'
  | 'too_many'
  | 'resend_cooldown'
  | 'resend_limit'

const MESSAGES: Record<Reason, string> = {
  not_found: '초대를 찾을 수 없습니다',
  expired: '초대가 만료되었습니다. 초대한 분께 다시 요청하세요',
  revoked: '취소된 초대입니다',
  accepted: '이미 사용한 초대입니다',
  email_mismatch: '초대받은 이메일 계정으로 로그인하세요',
  email_unverified: '이메일 인증을 마친 뒤 수락하세요',
  already_member: '이미 이 작업 공간의 구성원입니다',
  too_many: '대기 중인 초대가 너무 많습니다. 쓰지 않는 초대를 취소하세요',
  resend_cooldown: '방금 보냈습니다. 1분 뒤에 다시 보내세요',
  resend_limit: '다시 보내기 한도(5회)를 넘었습니다. 초대를 취소하고 새로 초대하세요',
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

  // 같은 이메일의 대기 초대가 있으면 새 행 대신 그 행을 다시 보낸다(토큰 재발급·역할 갱신).
  const existing = await prisma.spaceInvitation.findFirst({
    where: { spaceId: input.spaceId, email, ...pendingWhere(now) },
    select: { id: true },
  })
  if (existing) {
    const r = await resendInvitation(input.spaceId, existing.id, { role: input.role })
    return { ...r, converted: false, resent: true }
  }

  const token = randomBytes(32).toString('base64url')
  const invitation = await prisma.spaceInvitation.create({
    data: {
      spaceId: input.spaceId,
      email,
      role: input.role,
      tokenHash: hashInviteToken(token),
      invitedById: input.invitedById,
      expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000),
      lastSentAt: now,
      // 발송 성공은 recordSendResult 가 센다
      sendCount: 0,
    },
    select: { id: true, email: true, role: true, expiresAt: true },
  })
  // 개인 Space의 첫 초대는 팀 Space로 전환한다(OWNER+MFA 경로만 여기 온다). 초대가 만들어진 뒤에만 — 실패한 초대가 전환만 남기지 않게. 이미 전환됐으면 0건.
  const converted =
    space.type === 'PERSONAL' &&
    (
      await prisma.space.updateMany({
        where: { id: space.id, type: 'PERSONAL' },
        data: { type: 'ORGANIZATION' },
      })
    ).count > 0

  return {
    invitation: invitation as {
      id: string
      email: string
      role: 'ADMIN' | 'MEMBER'
      expiresAt: Date
    },
    token,
    converted,
    resent: false,
  }
}

/** 대기 초대를 새 토큰으로 다시 보낸다(이전 링크 무효, 만료 7일 재시작). 메일 발송은 호출 측. */
export async function resendInvitation(
  spaceId: string,
  invitationId: string,
  opts: { role?: 'ADMIN' | 'MEMBER' } = {}
) {
  if (opts.role && opts.role !== 'ADMIN' && opts.role !== 'MEMBER') throw new Error('invalid role')
  const now = new Date()
  const inv = await prisma.spaceInvitation.findFirst({
    where: { id: invitationId, spaceId, ...pendingWhere(now) },
    select: {
      id: true,
      email: true,
      role: true,
      lastSentAt: true,
      createdAt: true,
      sendCount: true,
    },
  })
  if (!inv) throw new InvitationError(404, 'not_found')
  const last = inv.lastSentAt ?? inv.createdAt
  if (now.getTime() - last.getTime() < RESEND_COOLDOWN_MS) {
    throw new InvitationError(429, 'resend_cooldown')
  }
  if (inv.sendCount >= MAX_SEND_COUNT) throw new InvitationError(429, 'resend_limit')

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000)
  // lastSentAt 이 읽은 값과 같을 때만 — 동시 클릭은 한 쪽만 통과한다.
  const claimed = await prisma.spaceInvitation.updateMany({
    where: { id: inv.id, spaceId, ...pendingWhere(now), lastSentAt: inv.lastSentAt },
    data: {
      tokenHash: hashInviteToken(token),
      expiresAt,
      lastSentAt: now,
      ...(opts.role && { role: opts.role }),
    },
  })
  if (claimed.count !== 1) {
    // 그 사이 수락·취소·만료됐으면 그 사유로, 아니면 동시 다시 보내기(쿨다운)로 알린다.
    const now2 = await prisma.spaceInvitation.findFirst({
      where: { id: inv.id, spaceId },
      select: { expiresAt: true, acceptedAt: true, revokedAt: true },
    })
    const state = now2 ? invitationState(now2) : 'not_found'
    if (state === 'not_found') throw new InvitationError(404, 'not_found')
    if (state !== 'pending') throw new InvitationError(410, state)
    throw new InvitationError(429, 'resend_cooldown')
  }
  return {
    invitation: {
      id: inv.id,
      email: inv.email,
      role: (opts.role ?? inv.role) as 'ADMIN' | 'MEMBER',
      expiresAt,
    },
    token,
  }
}

/** 메일 발송 결과 기록 — 성공만 sendCount 에 센다. */
export async function recordSendResult(invitationId: string, ok: boolean) {
  await prisma.spaceInvitation.update({
    where: { id: invitationId },
    data: ok ? { sendCount: { increment: 1 }, lastSendFailed: false } : { lastSendFailed: true },
  })
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
    invitedByName: inviter?.name ?? (inviter?.email ? maskEmail(inviter.email) : null),
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
  const tokenHash = hashInviteToken(input.token)
  const inv = await prisma.spaceInvitation.findUnique({
    where: { tokenHash },
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
    // 조건부 update로 한 번만 수락된다. 읽은 tokenHash·role 이 그대로일 때만 — 재발급·역할 갱신 뒤엔 이전 링크로 수락 불가.
    const claimed = await tx.spaceInvitation.updateMany({
      where: { id: inv.id, tokenHash, role: inv.role, ...pendingWhere(now) },
      data: { acceptedAt: now, acceptedUserId: input.user.id },
    })
    if (claimed.count !== 1) {
      // 누가 먼저 수락·취소했으면 그 상태, 토큰이 바뀌었거나 역할이 바뀌었으면 이 링크는 무효.
      const cur = await tx.spaceInvitation.findUnique({
        where: { tokenHash },
        select: { expiresAt: true, acceptedAt: true, revokedAt: true },
      })
      const curState = cur ? invitationState(cur) : 'pending'
      if (cur && curState !== 'pending') throw new InvitationError(410, curState)
      throw new InvitationError(404, 'not_found')
    }
    await tx.user.upsert({
      where: { id: input.user.id },
      create: {
        id: input.user.id,
        email: inv.email,
        name: input.user.name,
        signupSource: { utm_source: 'invite' },
      },
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

/** 대기 전부 + 최근 30일 내 수락·만료·취소. 이메일은 OWNER 화면용 원문. */
export async function listInvitations(spaceId: string) {
  const now = new Date()
  const cutoff = new Date(now.getTime() - RECENT_DAYS * 86_400_000)
  const rows = await prisma.spaceInvitation.findMany({
    where: {
      spaceId,
      OR: [
        pendingWhere(now),
        { acceptedAt: { gte: cutoff } },
        { revokedAt: { gte: cutoff } },
        { expiresAt: { gte: cutoff, lte: now } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      invitedById: true,
      lastSentAt: true,
      sendCount: true,
      lastSendFailed: true,
      acceptedAt: true,
      revokedAt: true,
    },
  })
  const withState = rows
    .map((r) => ({ ...r, state: invitationState(r, now) }))
    // 상태가 정해진 시각(수락·취소·만료)이 30일 안인 것만 — 대기는 전부
    .filter((r) => {
      const at = {
        pending: now,
        accepted: r.acceptedAt,
        revoked: r.revokedAt,
        expired: r.expiresAt,
      }[r.state]
      return at != null && at >= cutoff
    })
  const inviters = await prisma.user.findMany({
    where: { id: { in: [...new Set(withState.map((r) => r.invitedById))] } },
    select: { id: true, name: true, email: true },
  })
  const nameOf = new Map(inviters.map((u) => [u.id, u.name ?? u.email]))
  return withState.map(({ invitedById, ...r }) => ({
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
