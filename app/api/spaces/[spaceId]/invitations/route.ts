import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSpaceOwner } from '@/lib/agent/identity/space-admin'
import { isAal2Fresh, requireAal2 } from '@/lib/auth/mfa'
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

export async function POST(request: Request, { params }: Ctx) {
  const { spaceId } = await params
  // OWNER 만 — MEMBER 초대는 인증 앱 없이 허용, ADMIN 초대(권한을 주는 동작)만 아래에서 AAL2 요구.
  const owner = await requireSpaceOwner(spaceId)
  if ('error' in owner) return owner.error

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('이메일과 역할(ADMIN·MEMBER)을 확인하세요', 422, {
      issues: parsed.error.issues,
    })
  }
  // 같은 이메일 대기 초대를 ADMIN 으로 다시 초대하는 상향도 요청 역할이 ADMIN 이라 여기서 막힌다. ADMIN→MEMBER 하향은 권한 축소라 AAL1 허용.
  if (parsed.data.role === 'ADMIN') {
    const mfa = await requireAal2()
    if (mfa) return mfa
  }
  const aal = (await isAal2Fresh()) ? 'aal2' : 'aal1'
  const email = normalizeEmail(parsed.data.email)
  try {
    const { invitation, token, converted, resent } = await createInvitation({
      spaceId,
      email,
      role: parsed.data.role,
      invitedById: owner.userId,
    })
    // 감사 로그를 메일보다 먼저 — 로그 실패가 '메일은 갔는데 500·링크 없음'을 만들지 않게.
    if (converted)
      await writeAuditLog(owner.userId, 'space.type.convert', 'space', spaceId, {
        from: 'PERSONAL',
        to: 'ORGANIZATION',
        via: 'invitation',
      })
    await writeAuditLog(
      owner.userId,
      resent ? 'space.invitation.resend' : 'space.invitation.create',
      'space_invitation',
      invitation.id,
      {
        spaceId,
        email,
        role: parsed.data.role,
        aal,
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
      inviterId: owner.userId,
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

// 조회는 OWNER 만 — 보기만 하는 화면이라 AAL2 를 요구하지 않는다.
export async function GET(_request: Request, { params }: Ctx) {
  const { spaceId } = await params
  const owner = await requireSpaceOwner(spaceId)
  if ('error' in owner) return owner.error
  return NextResponse.json({ invitations: await listInvitations(spaceId) })
}
