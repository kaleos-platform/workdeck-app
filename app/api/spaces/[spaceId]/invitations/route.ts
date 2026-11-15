import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSpaceOwner } from '@/lib/agent/identity/space-admin'
import { requireAal2 } from '@/lib/auth/mfa'
import { writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { getAppOrigin } from '@/lib/domain'
import { sendInviteEmail } from '@/lib/spaces/invite-email'
import {
  InvitationError,
  createInvitation,
  listInvitations,
  recordSendResult,
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
    const { invitation, token, converted, resent } = await createInvitation({
      spaceId,
      email,
      role: parsed.data.role,
      invitedById: g.userId,
    })
    // 감사 로그를 메일보다 먼저 — 로그 실패가 '메일은 갔는데 500·링크 없음'을 만들지 않게.
    if (converted)
      await writeAuditLog(g.userId, 'space.type.convert', 'space', spaceId, {
        from: 'PERSONAL',
        to: 'ORGANIZATION',
        via: 'invitation',
      })
    await writeAuditLog(
      g.userId,
      resent ? 'space.invitation.resend' : 'space.invitation.create',
      'space_invitation',
      invitation.id,
      {
        spaceId,
        email,
        role: parsed.data.role,
      }
    )
    // 요청 Host가 아니라 설정된 앱 origin — Host 헤더로 링크·redirectTo를 조작하지 못하게.
    const origin = getAppOrigin()
    const invitePath = `/invite/${token}`
    const mail = await sendInviteEmail({
      email,
      invitePath,
      origin,
      invitationId: invitation.id,
      spaceId,
      inviterId: g.userId,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    })
    try {
      await recordSendResult(invitation.id, mail.sent)
    } catch (e) {
      console.error('[invitations] 발송 결과 기록 실패', { invitationId: invitation.id, e })
    }
    return NextResponse.json(
      {
        invitationId: invitation.id,
        resent,
        link: `${origin}${invitePath}`,
        emailSent: mail.sent,
        ...(mail.sent ? {} : { emailSkipReason: mail.reason }),
        expiresAt: invitation.expiresAt,
      },
      { status: resent ? 200 : 201 }
    )
  } catch (err) {
    if (err instanceof InvitationError)
      return errorResponse(err.message, err.status, { reason: err.reason })
    throw err
  }
}

// 조회는 OWNER 만 — 보기만 하는 화면이라 AAL2 를 요구하지 않는다(변경 동작은 각 경로에서 단계 인증).
export async function GET(_request: Request, { params }: Ctx) {
  const { spaceId } = await params
  const owner = await requireSpaceOwner(spaceId)
  if ('error' in owner) return owner.error
  return NextResponse.json({ invitations: await listInvitations(spaceId) })
}
