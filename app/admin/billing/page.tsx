import { BillingDashboard } from '@/components/admin/billing-dashboard'

export default function AdminBillingPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">결제 관리</h1>
        <p className="text-sm text-muted-foreground">
          Deck 과금 모드, Space 구독 현황, 최근 청구 내역을 관리합니다
        </p>
      </div>
      <BillingDashboard />
    </div>
  )
}
