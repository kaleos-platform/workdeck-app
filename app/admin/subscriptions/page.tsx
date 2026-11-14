import { SubscriptionsClient } from '@/components/admin/subscriptions-client'

export default function AdminSubscriptionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">구독 현황</h1>
        <p className="text-sm text-muted-foreground">
          Space·덱별 이용 상태, 체험 종료일과 면제를 관리합니다. 체험은 자동 결제로 전환되지
          않습니다.
        </p>
      </div>
      <SubscriptionsClient />
    </div>
  )
}
