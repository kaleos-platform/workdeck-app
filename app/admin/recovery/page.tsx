import { notFound, redirect } from 'next/navigation'
import { requireOperator } from '@/lib/admin/auth'
import { mfaStepUpPath } from '@/lib/auth/mfa-policy'
import { RecoveryKeySettings } from '@/components/admin/recovery-key-settings'

export default async function AdminRecoveryPage() {
  const auth = await requireOperator()
  if (!auth.ok && auth.reason === 'MFA_REQUIRED') redirect(mfaStepUpPath('/admin/recovery'))
  if (!auth.ok) notFound()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">복구 관리</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          암호화 키의 보관 상태와 사본 일치 검증을 관리합니다.
        </p>
      </div>
      <RecoveryKeySettings />
    </div>
  )
}
