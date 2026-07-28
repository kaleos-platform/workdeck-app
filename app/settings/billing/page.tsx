import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { SETTINGS_BILLING_PATH } from '@/lib/deck-routes'
import { BillingSettingsClient } from '@/components/billing/billing-settings-client'

// 구독 관리 설정 — 구독 상태, 결제수단, deck별 구독, 결제 내역.
export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ cardRegistered?: string; error?: string }>
}) {
  const user = await getUser()
  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(SETTINGS_BILLING_PATH)}`)
  }

  const { cardRegistered, error } = await searchParams

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">구독 관리</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          워크덱 deck 구독과 결제수단, 결제 내역을 관리하세요.
        </p>
      </div>

      <BillingSettingsClient cardRegistered={cardRegistered ?? null} initialError={error ?? null} />
    </div>
  )
}
