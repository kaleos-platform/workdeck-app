import { NextResponse } from 'next/server'
import { z } from 'zod'
import { writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { getAppOrigin } from '@/lib/domain'
import { checkRateLimit } from '@/lib/hiring/applications'
import { publicRequestKey } from '@/lib/hiring/public-request'
import { prisma } from '@/lib/prisma'
import { isEmailExistsError } from '@/lib/spaces/invite-email'
import { sendInviteSignupEmail } from '@/lib/spaces/invite-signup-email'
import { findInvitationByToken, invitationState, normalizeEmail } from '@/lib/spaces/invitations'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'

const ACTION = 'space.invitation.self_verify'
const bodySchema = z.object({ email: z.string().trim().min(1).max(320) })

// 공개 — 초대 링크를 가진 사람이 초대 이메일을 입력해 인증 메일을 받는다. 비밀번호는 받지 않는다
// (이메일 인증 세션을 얻은 뒤 초대 화면의 needs_password 에서만 정한다).
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  // 이메일 대조 시도도 IP 단위로 제한한다(토큰 보유자의 초대 이메일 추측 방지).
  if (!checkRateLimit(publicRequestKey(request))) return rateLimited()
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('이메일을 입력하세요', 400, { reason: 'invalid' })

  const inv = await findInvitationByToken(token)
  if (!inv) return errorResponse('초대를 찾을 수 없습니다', 404, { reason: 'not_found' })
  const state = invitationState(inv)
  if (state !== 'pending') return errorResponse('사용할 수 없는 초대입니다', 410, { reason: state })
  if (normalizeEmail(parsed.data.email) !== normalizeEmail(inv.email)) {
    return errorResponse('초대받은 이메일과 다릅니다', 400, { reason: 'email_mismatch' })
  }

  const now = Date.now()
  const where = {
    targetType: 'space_invitation',
    targetId: inv.id,
    action: ACTION,
  }
  const [lastMinute, lastHour] = await Promise.all([
    prisma.adminAuditLog.count({ where: { ...where, createdAt: { gt: new Date(now - 60_000) } } }),
    prisma.adminAuditLog.count({
      where: { ...where, createdAt: { gt: new Date(now - 3_600_000) } },
    }),
  ])
  if (lastMinute >= 1 || lastHour >= 5) return rateLimited()

  // 발송 직전에 소유자가 새 링크를 발급하지 않았는지 다시 확인한다(토큰이 바뀌면 조회되지 않는다).
  const fresh = await findInvitationByToken(token)
  if (!fresh || fresh.id !== inv.id || invitationState(fresh) !== 'pending') {
    return errorResponse('초대가 새로 발급되었습니다. 초대한 분께 새 링크를 받으세요', 409, {
      reason: 'stale',
    })
  }

  const admin = getSupabaseAdminClient().auth.admin
  const email = fresh.email
  const invitePath = `/invite/${token}`
  let linkType: 'invite' | 'magiclink' = 'invite'
  let { data: link, error } = await admin.generateLink({
    type: 'invite',
    email,
    options: { data: { invite_path: invitePath } },
  })
  if (error && isEmailExistsError(error)) {
    // 이미 인증된 사용자 — 앱 계정이 있으면 로그인을 요구하고, 없을 때만 로그인 링크를 보낸다.
    const mail = await admin.generateLink({ type: 'magiclink', email })
    const existing = mail.data?.user
    if (existing && (await prisma.user.findUnique({ where: { id: existing.id } }))) {
      return errorResponse('이미 워크덱 계정이 있습니다. 로그인해서 참여하세요', 409, {
        reason: 'registered',
      })
    }
    linkType = 'magiclink'
    ;({ data: link, error } = mail)
  }
  const hashedToken = link?.properties?.hashed_token
  if (error || !hashedToken) {
    console.error('[invite-signup] 링크 생성 실패', { status: error?.status, code: error?.code })
    return sendFailed()
  }

  const confirmUrl =
    `${getAppOrigin()}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}` +
    `&type=${linkType}&next=${encodeURIComponent(invitePath)}`
  try {
    const sent = await sendInviteSignupEmail({
      to: email,
      link: confirmUrl,
      token,
      invitationId: inv.id,
      spaceName: inv.spaceName,
    })
    if (!sent) return sendFailed()
  } catch (e) {
    console.error('[invite-signup] 메일 발송 실패', {
      error: e instanceof Error ? e.message : 'unknown',
    })
    return sendFailed()
  }
  // 발송에 성공했을 때만 제한 기록을 남긴다. 소유자의 sendCount/lastSentAt 은 건드리지 않는다.
  await writeAuditLog('anonymous', ACTION, 'space_invitation', inv.id)
  return NextResponse.json({ sent: true })
}

function rateLimited() {
  return errorResponse('잠시 후 다시 시도하세요', 429, { reason: 'rate_limited' })
}

function sendFailed() {
  return errorResponse('인증 메일을 보내지 못했습니다. 잠시 후 다시 시도하세요', 502, {
    reason: 'send_failed',
  })
}
