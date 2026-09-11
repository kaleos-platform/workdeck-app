import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { SETTINGS_BILLING_PATH } from '@/lib/deck-routes'
import { SubscriptionSettingsClient } from '@/components/billing/subscription-settings-client'

// 구독 관리 — 구독 상태와 업무별 구독. 결제수단·결제 내역은 /settings/payments.
export default async function SubscriptionSettingsPage() {
  const user = await getUser()
  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(SETTINGS_BILLING_PATH)}`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">구독 관리</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          워크스페이스에서 이용할 업무를 구독하고 관리하세요.
        </p>
      </div>

      <SubscriptionSettingsClient />
    </div>
  )
}
