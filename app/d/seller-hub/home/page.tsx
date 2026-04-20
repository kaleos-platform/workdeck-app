import { RevenueKpiCards } from '@/components/sh/home/revenue-kpi-cards'
import { ChannelRevenueChart } from '@/components/sh/home/channel-revenue-chart'
import { ChannelRevenueTable } from '@/components/sh/home/channel-revenue-table'
import { StockAlertsCard } from '@/components/sh/home/stock-alerts-card'
import { ShippingTodayCard } from '@/components/sh/home/shipping-today-card'

export default function SellerHubHomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">홈</h1>
        <p className="text-sm text-muted-foreground">
          채널별 매출 현황과 주요 지표를 한눈에 확인합니다
        </p>
      </div>
      <RevenueKpiCards />
      <div className="grid gap-4 md:grid-cols-2">
        <StockAlertsCard />
        <ShippingTodayCard />
      </div>
      <ChannelRevenueChart />
      <ChannelRevenueTable />
    </div>
  )
}
