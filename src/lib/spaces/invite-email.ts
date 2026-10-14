import 'server-only'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'

type SkipReason = 'already_registered' | 'stale_resend' | 'send_failed'

/**
 * 미가입 이메일에 Supabase 초대 메일을 보낸다. 메일 링크는 Supabase 대시보드 "Invite user" 템플릿이
 * {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next={{ .Data.invite_path }} 로 만든다.
 * 이미 가입한 이메일은 Supabase가 거부하므로 링크 복사로 전달한다.
 *
 * 재초대: GoTrue(v2.188 확인)는 미확인 기존 사용자에게 초대를 다시 보낼 때 data(user_metadata)를 갱신하지 않아
 * 메일의 {{ .Data.invite_path }}가 취소된 이전 토큰을 가리킨다. 그래서 먼저 generateLink(메일 안 보냄)로
 * 사용자를 만들거나 찾고, invite_path가 다르면 갱신한 뒤에만 메일을 보낸다. 갱신 못 하면 보내지 않는다.
 */
export async function sendInviteEmail(input: {
  email: string
  invitePath: string
  origin: string
}): Promise<{ sent: true } | { sent: false; reason: SkipReason }> {
  const admin = getSupabaseAdminClient().auth.admin
  const data = { invite_path: input.invitePath }

  const { data: link, error: linkError } = await admin.generateLink({
    type: 'invite',
    email: input.email,
    options: { data },
  })
  if (linkError) return skip(linkError)
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
  return error ? skip(error) : { sent: true }
}

function skip(error: { code?: string; status?: number; message: string }): {
  sent: false
  reason: SkipReason
} {
  const { code, status } = error
  // 최신 GoTrue는 code 'email_exists'(422), 옛 GoTrue는 code 없이 422 + "already been registered" 메시지.
  // 422만으로는 판정하지 않는다 — email_address_invalid 등도 422다.
  if (
    code === 'email_exists' ||
    (status === 422 && /already been registered/i.test(error.message))
  ) {
    return { sent: false, reason: 'already_registered' }
  }
  console.error('[invite-email] Supabase 초대 메일 실패', { status, code })
  return { sent: false, reason: 'send_failed' }
}
