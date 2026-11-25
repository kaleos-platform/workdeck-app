import { AccountSettingsForm } from '@/components/settings/account-settings-form'
import { MfaCard } from '@/components/settings/mfa-card'
import { OAuthGrantsCard } from '@/components/settings/oauth-grants-card'
import { isMfaRequiredForCurrentUser } from '@/lib/auth/mfa'
import { createClient } from '@/lib/supabase/server'

export default async function AccountSettingsPage() {
  // 필수 계정이나 이미 인증 앱을 등록한 계정에만 인증 카드를 보인다 — 꺼진 미등록 계정에 "미등록" 안내는 혼란만 준다.
  const supabase = await createClient()
  const [required, factors] = await Promise.all([
    isMfaRequiredForCurrentUser(),
    supabase.auth.mfa.listFactors(),
  ])
  const showMfa = required || (factors.data?.totp.length ?? 0) > 0
  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">계정 설정</h1>
        <p className="text-sm text-muted-foreground">
          로그인 계정 정보, 비밀번호, {showMfa && '2단계 인증, '}연결된 AI 앱을 관리합니다.
          워크스페이스 결제는 [결제 수단·내역]에서 확인하세요.
        </p>
      </header>
      <AccountSettingsForm />
      {showMfa && <MfaCard />}
      <OAuthGrantsCard />
    </div>
  )
}
