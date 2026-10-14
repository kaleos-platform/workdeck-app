import 'server-only'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'

/**
 * 미가입 이메일에 Supabase 초대 메일을 보낸다. 메일 링크는 Supabase 대시보드 "Invite user" 템플릿이
 * {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next={{ .Data.invite_path }} 로 만든다.
 * 이미 가입한 이메일은 Supabase가 거부하므로 링크 복사로 전달한다.
 */
export async function sendInviteEmail(input: {
  email: string
  invitePath: string
  origin: string
}): Promise<{ sent: true } | { sent: false; reason: 'already_registered' | 'send_failed' }> {
  const { error } = await getSupabaseAdminClient().auth.admin.inviteUserByEmail(input.email, {
    data: { invite_path: input.invitePath },
    redirectTo: `${input.origin}/auth/confirm`,
  })
  if (!error) return { sent: true }
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
