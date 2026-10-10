import { notFound, redirect } from 'next/navigation'
import { requireOperator } from '@/lib/admin/auth'
import { mfaStepUpPath } from '@/lib/auth/mfa-policy'
import { AccountSettings } from '@/components/admin/account-settings'

export default async function AdminAccountPage() {
  const auth = await requireOperator()
  // MFA 등록·단계 인증은 /auth/mfa 가 맡는다.
  if (!auth.ok && auth.reason === 'MFA_REQUIRED') redirect(mfaStepUpPath('/admin/account'))
  if (!auth.ok) notFound()

  return <AccountSettings email={auth.user.email} />
}
