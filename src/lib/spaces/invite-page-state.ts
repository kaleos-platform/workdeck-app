// 초대 페이지가 어떤 화면을 보여 줄지 — 순수 함수(테스트 대상).
const norm = (s: string) => s.trim().toLowerCase()

export function inviteView(input: {
  state: 'pending' | 'expired' | 'revoked' | 'accepted' | 'not_found'
  inviteEmail: string | null
  user: {
    email?: string | null
    invited_at?: string | null
    user_metadata?: Record<string, unknown>
  } | null
}): 'invalid' | 'anonymous' | 'wrong_account' | 'needs_password' | 'ready' {
  if (input.state !== 'pending' || !input.inviteEmail) return 'invalid'
  if (!input.user) return 'anonymous'
  if (norm(input.user.email ?? '') !== norm(input.inviteEmail)) return 'wrong_account'
  // Supabase 초대 메일로 만들어진 계정은 비밀번호가 없다 — 수락 전에 정하게 한다.
  if (input.user.invited_at && !input.user.user_metadata?.password_set) return 'needs_password'
  return 'ready'
}
