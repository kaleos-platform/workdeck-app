import 'server-only'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { prisma } from '@/lib/prisma'
import { maskEmail } from '@/lib/spaces/invitations'
import { sendMemberInviteEmail } from '@/lib/spaces/member-invite-email'

type SkipReason = 'stale_resend' | 'send_failed'
type MailResult = { sent: true; via: 'supabase' | 'resend' } | { sent: false; reason: SkipReason }

/**
 * 미가입 이메일에 Supabase 초대 메일을 보낸다. 메일 링크는 Supabase 대시보드 "Invite user" 템플릿이
 * {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next={{ .Data.invite_path }} 로 만든다.
 * 이미 가입한 이메일은 Supabase가 거부하므로 Resend 로 별도 초대 메일(링크 /invite/{token})을 보낸다.
 *
 * 재초대: GoTrue(v2.188 확인)는 미확인 기존 사용자에게 초대를 다시 보낼 때 data(user_metadata)를 갱신하지 않아
 * 메일의 {{ .Data.invite_path }}가 취소된 이전 토큰을 가리킨다. 그래서 먼저 generateLink(메일 안 보냄)로
 * 사용자를 만들거나 찾고, invite_path가 다르면 갱신한 뒤에만 메일을 보낸다. 갱신 못 하면 보내지 않는다.
 */
export async function sendInviteEmail(input: {
  email: string
  invitePath: string
  origin: string
  // 가입자 메일(Resend) 본문용
  invitationId: string
  spaceId: string
  inviterId: string
  role: 'ADMIN' | 'MEMBER'
  expiresAt: Date
}): Promise<MailResult> {
  const admin = getSupabaseAdminClient().auth.admin
  const data = { invite_path: input.invitePath }

  const { data: link, error: linkError } = await admin.generateLink({
    type: 'invite',
    email: input.email,
    options: { data },
  })
  if (linkError) return skip(linkError, input)
  const user = link.user
  if (user.user_metadata?.invite_path !== input.invitePath) {
    const { error } = await admin.updateUserById(user.id, {
      user_metadata: { ...user.user_metadata, ...data },
    })
    if (error) {
      console.error('[invite-email] 재초대 invite_path 갱신 실패', {
        status: error.status,
        code: error.code,
      })
      return { sent: false, reason: 'stale_resend' }
    }
  }

  const { error } = await admin.inviteUserByEmail(input.email, {
    data,
    redirectTo: `${input.origin}/auth/confirm`,
  })
  return error ? skip(error, input) : { sent: true, via: 'supabase' }
}

async function skip(
  error: { code?: string; status?: number; message: string },
  input: Parameters<typeof sendInviteEmail>[0]
): Promise<MailResult> {
  const { code, status } = error
  // 최신 GoTrue는 code 'email_exists'(422), 옛 GoTrue는 code 없이 422 + "already been registered" 메시지.
  // 422만으로는 판정하지 않는다 — email_address_invalid 등도 422다.
  if (
    code === 'email_exists' ||
    (status === 422 && /already been registered/i.test(error.message))
  ) {
    return sendToRegistered(input)
  }
  console.error('[invite-email] Supabase 초대 메일 실패', { status, code })
  return { sent: false, reason: 'send_failed' }
}

async function sendToRegistered(input: Parameters<typeof sendInviteEmail>[0]): Promise<MailResult> {
  try {
    const [space, inviter] = await Promise.all([
      prisma.space.findUnique({ where: { id: input.spaceId }, select: { name: true } }),
      prisma.user.findUnique({
        where: { id: input.inviterId },
        select: { name: true, email: true },
      }),
    ])
    const sent = await sendMemberInviteEmail({
      to: input.email,
      link: `${input.origin}${input.invitePath}`,
      token: input.invitePath.replace('/invite/', ''),
      invitationId: input.invitationId,
      spaceName: space?.name ?? '작업 공간',
      inviterName: inviter?.name ?? (inviter?.email ? maskEmail(inviter.email) : '관리자'),
      role: input.role,
      expiresAt: input.expiresAt,
    })
    return sent ? { sent: true, via: 'resend' } : { sent: false, reason: 'send_failed' }
  } catch (e) {
    console.error('[invite-email] 가입자 초대 메일 실패', {
      error: e instanceof Error ? e.message : 'unknown',
    })
    return { sent: false, reason: 'send_failed' }
  }
}
