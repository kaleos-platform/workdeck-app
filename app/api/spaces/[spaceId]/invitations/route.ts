import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSpaceOwner } from '@/lib/agent/identity/space-admin'
import { requireAal2 } from '@/lib/auth/mfa'
import { writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { sendInviteEmail } from '@/lib/spaces/invite-email'
import {
  InvitationError,
  createInvitation,
  listPendingInvitations,
  normalizeEmail,
} from '@/lib/spaces/invitations'

const bodySchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(['ADMIN', 'MEMBER']),
})

type Ctx = { params: Promise<{ spaceId: string }> }

// OWNER + MFA — ADMIN 이상 권한을 줄 수 있는 작업이라 자격증명 저장과 같은 등급.
async function guard(spaceId: string): Promise<{ userId: string } | { error: NextResponse }> {
  const owner = await requireSpaceOwner(spaceId)
  if ('error' in owner) return { error: owner.error }
  const mfa = await requireAal2()
  if (mfa) return { error: mfa }
  return { userId: owner.userId }
}

export async function POST(request: Request, { params }: Ctx) {
  const { spaceId } = await params
  const g = await guard(spaceId)
  if ('error' in g) return g.error

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('이메일과 역할(ADMIN·MEMBER)을 확인하세요', 422, {
      issues: parsed.error.issues,
    })
  }
  const email = normalizeEmail(parsed.data.email)
  try {
    const { invitation, token } = await createInvitation({
      spaceId,
      email,
      role: parsed.data.role,
      invitedById: g.userId,
    })
    const origin = new URL(request.url).origin
    const invitePath = `/invite/${token}`
    const mail = await sendInviteEmail({ email, invitePath, origin })
    await writeAuditLog(g.userId, 'space.invitation.create', 'space_invitation', invitation.id, {
      spaceId,
      email,
      role: parsed.data.role,
    })
    return NextResponse.json(
      {
        invitationId: invitation.id,
        link: `${origin}${invitePath}`,
        emailSent: mail.sent,
        ...(mail.sent ? {} : { emailSkipReason: mail.reason }),
        expiresAt: invitation.expiresAt,
      },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof InvitationError)
      return errorResponse(err.message, err.status, { reason: err.reason })
    throw err
  }
}

export async function GET(_request: Request, { params }: Ctx) {
  const { spaceId } = await params
  const g = await guard(spaceId)
  if ('error' in g) return g.error
  return NextResponse.json({ invitations: await listPendingInvitations(spaceId) })
}
