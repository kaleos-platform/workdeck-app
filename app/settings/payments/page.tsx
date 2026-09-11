import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { SETTINGS_PAYMENTS_PATH } from '@/lib/deck-routes'
import { PaymentSettingsClient } from '@/components/billing/payment-settings-client'

// 결제 관리 — 결제수단과 결제 내역. 업무 구독은 /settings/billing.
export default async function PaymentSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ cardRegistered?: string; error?: string }>
}) {
  const user = await getUser()
  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(SETTINGS_PAYMENTS_PATH)}`)
  }

  const { cardRegistered, error } = await searchParams

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">결제 관리</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          정기 결제에 사용할 카드와 결제 내역을 관리하세요.
        </p>
      </div>

      <PaymentSettingsClient cardRegistered={cardRegistered ?? null} initialError={error ?? null} />
    </div>
  )
}
