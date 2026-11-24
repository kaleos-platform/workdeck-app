import { randomBytes } from 'node:crypto'
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

  // 이미 워크덱을 쓰는 계정이면 링크를 만들지 않는다 — 만들면 그 사람의 비밀번호 재설정 링크가 무효가 된다.
  const appUser = await prisma.user.findFirst({
    where: { email: { equals: fresh.email, mode: 'insensitive' } },
    select: { id: true },
  })
  if (appUser) {
    return errorResponse('이미 워크덱 계정이 있습니다. 로그인해서 참여하세요', 409, {
      reason: 'registered',
    })
  }

  const admin = getSupabaseAdminClient().auth.admin
  const email = fresh.email
  const invitePath = `/invite/${token}`
  const startedAt = Date.now()
  let linkType: 'invite' | 'magiclink' = 'invite'
  let { data: link, error } = await admin.generateLink({
    type: 'invite',
    email,
    options: { data: { invite_path: invitePath } },
  })
  if (error && isEmailExistsError(error)) {
    // 인증은 됐지만 앱 계정이 없는 사용자(초대 링크를 보안 장비가 먼저 써 버린 경우 등) — 로그인 링크.
    linkType = 'magiclink'
    ;({ data: link, error } = await admin.generateLink({ type: 'magiclink', email }))
  } else if (!error && link?.user && Date.parse(link.user.created_at) < startedAt - 60_000) {
    // 이전부터 있던 미인증 계정 — 남이 미리 정해 둔 비밀번호가 인증 뒤 살아남지 않게 무효화한다.
    // 비밀번호는 인증 후 초대 화면(needs_password)에서 새로 정한다.
    const { error: resetError } = await admin.updateUserById(link.user.id, {
      password: randomBytes(32).toString('base64url'),
    })
    if (resetError) {
      console.error('[invite-signup] 기존 미인증 비밀번호 무효화 실패', { code: resetError.code })
      return sendFailed()
    }
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
  try {
    await writeAuditLog('anonymous', ACTION, 'space_invitation', inv.id)
  } catch (e) {
    // 메일은 이미 나갔다 — 기록 실패로 사용자에게 오류를 보이지 않는다.
    console.error('[invite-signup] 발송 기록 실패', {
      error: e instanceof Error ? e.message : 'unknown',
    })
  }
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
