import { NextResponse } from 'next/server'
import { requireSpaceOwner } from '@/lib/agent/identity/space-admin'
import { writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { getAppOrigin } from '@/lib/domain'
import { sendInviteEmail } from '@/lib/spaces/invite-email'
import { InvitationError, recordSendResult, resendInvitation } from '@/lib/spaces/invitations'

// 다시 보내기는 OWNER 만(AAL2 면제) — 역할은 바꾸지 않고 새 토큰만 발급한다.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ spaceId: string; invitationId: string }> }
) {
  const { spaceId, invitationId } = await params
  const owner = await requireSpaceOwner(spaceId)
  if ('error' in owner) return owner.error
  try {
    const { invitation, token } = await resendInvitation(spaceId, invitationId)
    await writeAuditLog(
      owner.userId,
      'space.invitation.resend',
      'space_invitation',
      invitation.id,
      {
        spaceId,
      }
    )
    const origin = getAppOrigin()
    const invitePath = `/invite/${token}`
    const mail = await sendInviteEmail({
      email: invitation.email,
      invitePath,
      origin,
      invitationId: invitation.id,
      spaceId,
      inviterId: owner.userId,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    })
    try {
      await recordSendResult(invitation.id, mail.sent)
    } catch (e) {
      console.error('[invitations] 발송 결과 기록 실패', { invitationId: invitation.id, e })
    }
    return NextResponse.json({
      link: `${origin}${invitePath}`,
      emailSent: mail.sent,
      ...(mail.sent ? {} : { emailSkipReason: mail.reason }),
      expiresAt: invitation.expiresAt,
    })
  } catch (err) {
    if (err instanceof InvitationError)
      return errorResponse(err.message, err.status, { reason: err.reason })
    throw err
  }
}
