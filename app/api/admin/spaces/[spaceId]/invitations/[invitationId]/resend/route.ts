import { NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { getAppOrigin } from '@/lib/domain'
import { sendInviteEmail } from '@/lib/spaces/invite-email'
import { InvitationError, recordSendResult, resendInvitation } from '@/lib/spaces/invitations'

// 운영자 다시 발급 — 새 토큰으로 링크를 바꾸고(이전 링크 무효) 운영자가 직접 전달할 링크를 돌려준다.
// 발송 횟수 상한만 무시한다(쿨다운·대기 조건은 그대로). 링크는 응답에서만 노출한다.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ spaceId: string; invitationId: string }> }
) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  const { spaceId, invitationId } = await params
  try {
    // 감사 로그를 먼저 — 실패하면 throw 되어 토큰이 바뀌지 않는다(기존 링크 유효).
    await writeAuditLog(
      auth.user.id,
      'space.invitation.operator_resend',
      'space_invitation',
      invitationId,
      { spaceId, phase: 'attempt' }
    )
    const { invitation, token } = await resendInvitation(spaceId, invitationId, {
      ignoreSendLimit: true,
    })
    const origin = getAppOrigin()
    const invitePath = `/invite/${token}`
    const mail = await sendInviteEmail({
      email: invitation.email,
      invitePath,
      origin,
      invitationId: invitation.id,
      spaceId,
      // 메일의 "초대한 사람"은 운영자가 아니라 원 초대자
      inviterId: invitation.invitedById,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    })
    try {
      await recordSendResult(invitation.id, mail.sent)
      // 실제 재발급 완료 기록 — attempt 만 있고 done 이 없으면 재발급 실패(토큰 미교체 또는 응답 전 오류).
      await writeAuditLog(
        auth.user.id,
        'space.invitation.operator_resend',
        'space_invitation',
        invitation.id,
        { spaceId, phase: 'done', emailSent: mail.sent }
      )
    } catch (e) {
      // 토큰은 이미 바뀌었다 — 기록 실패로 링크를 잃지 않게 응답은 계속한다.
      console.error('[invitations] 발송 결과·완료 기록 실패', { invitationId: invitation.id, e })
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
