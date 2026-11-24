import 'server-only'
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { buildAppUrl } from '@/lib/domain'
import { sanitizeSignupSource } from './signup-source'

type LeadClient = Pick<Prisma.TransactionClient, 'marketingLead'>
const emailWhere = (email: string) => ({
  equals: email.trim().toLowerCase(),
  mode: 'insensitive' as const,
})

export function isLeadGateEnabled() {
  return process.env.SIGNUP_REQUIRES_LEAD !== 'off'
}

export class SignupNotAllowedError extends Error {
  constructor() {
    super('도입 문의에 남긴 이메일로 가입해 주세요')
    this.name = 'SignupNotAllowedError'
  }
}

export async function findSignupLead(email: string, tx: LeadClient = prisma) {
  if (!email.trim()) return null
  return tx.marketingLead.findFirst({
    where: { email: emailWhere(email), status: { not: 'DROPPED' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}

export function leadSignupSource(lead: { utm: unknown; referrer: string | null; createdAt: Date }) {
  const utm = lead.utm && typeof lead.utm === 'object' && !Array.isArray(lead.utm) ? lead.utm : {}
  return sanitizeSignupSource({
    ...utm,
    referrer: lead.referrer,
    landing: 'lead',
    at: lead.createdAt.toISOString(),
  })!
}

export async function markLeadsConverted(email: string, tx: LeadClient) {
  return tx.marketingLead.updateMany({
    where: { email: emailWhere(email), status: { in: ['NEW', 'CONTACTED'] } },
    data: { status: 'CONVERTED' },
  })
}

export async function markLeadsContacted(email: string, tx: LeadClient = prisma) {
  return tx.marketingLead.updateMany({
    where: { email: emailWhere(email), status: 'NEW' },
    data: { status: 'CONTACTED' },
  })
}

function tokenSignature(leadId: string) {
  const hex = process.env.ENCRYPTION_KEY?.trim()
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error('가입 링크를 생성할 수 없습니다')
  const key = Buffer.from(
    hkdfSync('sha256', Buffer.from(hex, 'hex'), '', 'workdeck:lead-signup:v1', 32)
  )
  return createHmac('sha256', key).update(leadId).digest('base64url')
}

export function signLeadToken(leadId: string) {
  return `${leadId}.${tokenSignature(leadId)}`
}

export function leadSignupUrl(leadId: string, redirectTo?: string) {
  const params = new URLSearchParams({ lead: signLeadToken(leadId) })
  if (redirectTo) params.set('redirectTo', redirectTo)
  return buildAppUrl(`/signup?${params}`)
}

export async function verifyLeadToken(token: string) {
  const match = /^([a-zA-Z0-9_-]{1,128})\.([a-zA-Z0-9_-]{43})$/.exec(token)
  if (!match) return null
  let expected: Buffer
  try {
    expected = Buffer.from(tokenSignature(match[1]))
  } catch {
    return null
  }
  const actual = Buffer.from(match[2])
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  const lead = await prisma.marketingLead.findUnique({ where: { id: match[1] } })
  return lead && lead.status !== 'DROPPED' ? lead : null
}

/** User 생성과 리드 전환은 호출 측 트랜잭션에서 함께 처리한다. */
export async function ensureSignupUser(
  tx: Prisma.TransactionClient,
  user: { id: string; email?: string | null; name?: string | null },
  options: {
    invitation?: boolean
    deferWithoutLead?: boolean
    fallbackSource?: Prisma.InputJsonValue | null
  } = {}
): Promise<{ id: string } | null> {
  // OAuth·초대·초기 설정이 동시에 들어와도 User를 한 번만 만들고 최초 출처를 보존한다.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`
  const existing = await tx.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true },
  })
  const email = user.email?.trim().toLowerCase() ?? ''
  if (existing) {
    const authEmail = user.email ?? ''
    if (existing.email !== authEmail)
      await tx.user.update({ where: { id: user.id }, data: { email: authEmail } })
    return { id: existing.id }
  }
  const lead = await findSignupLead(email, tx)
  if (!lead && isLeadGateEnabled() && !options.invitation) {
    if (options.deferWithoutLead) return null
    throw new SignupNotAllowedError()
  }
  const created = await tx.user.create({
    data: {
      id: user.id,
      email,
      name: user.name ?? null,
      signupSource: lead
        ? leadSignupSource(lead)
        : options.invitation
          ? { utm_source: 'invite' }
          : (options.fallbackSource ?? undefined),
    },
    select: { id: true },
  })
  if (lead) await markLeadsConverted(email, tx)
  return created
}
