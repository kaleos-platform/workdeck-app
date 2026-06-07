import { RevenueKpiCards } from '@/components/sh/home/revenue-kpi-cards'
import { StockAlertsCard } from '@/components/sh/home/stock-alerts-card'
import { ShippingTodayCard } from '@/components/sh/home/shipping-today-card'
import { OnboardingProgressCard } from '@/components/sh/home/onboarding-progress-card'

export default function SellerHubHomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">홈</h1>
        <p className="text-sm text-muted-foreground">주요 지표와 운영 현황을 한눈에 확인합니다</p>
      </div>
      <OnboardingProgressCard />
      <RevenueKpiCards />
      <div className="grid gap-4 md:grid-cols-2">
        <StockAlertsCard />
        <ShippingTodayCard />
      </div>
    </div>
  )
}
