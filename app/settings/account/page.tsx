import { AccountSettingsForm } from '@/components/settings/account-settings-form'

export default function AccountSettingsPage() {
  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">계정 설정</h1>
        <p className="text-sm text-muted-foreground">
          로그인 계정 정보와 비밀번호를 관리합니다. 워크스페이스 결제는 [결제 관리]에서 확인하세요.
        </p>
      </header>
      <AccountSettingsForm />
    </div>
  )
}
