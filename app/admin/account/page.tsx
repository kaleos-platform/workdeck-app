import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/admin/auth'
import { AccountSettings } from '@/components/admin/account-settings'

export default async function AdminAccountPage() {
  const auth = await requireOperator()
  // NOT_OPERATOR만 은닉한다 — MFA_REQUIRED는 등록하러 오는 곳이므로 반드시 렌더돼야 한다.
  if (!auth.ok && auth.reason === 'NOT_OPERATOR') notFound()

  // 이 시점에서 auth는 ok:true 또는 reason:'MFA_REQUIRED' — 둘 다 user를 가짐
  return <AccountSettings email={auth.user.email} />
}
