import { OnboardingProgressCard } from '@/components/sh/home/onboarding-progress-card'
import { HomeSection } from '@/components/sh/home/home-section'
import { SalesSummaryCard } from '@/components/sh/home/sales-summary-card'
import { ProductRankingCard } from '@/components/sh/home/product-ranking-card'
import { ChannelStockCard } from '@/components/sh/home/channel-stock-card'
import { StockAlertsCard } from '@/components/sh/home/stock-alerts-card'
import { StockAdjustmentCard } from '@/components/sh/home/stock-adjustment-card'
import { ReorderStatusCard } from '@/components/sh/home/reorder-status-card'
import { ShippingTodayCard } from '@/components/sh/home/shipping-today-card'
import { ShippingUnprocessedCard } from '@/components/sh/home/shipping-unprocessed-card'
import { OperationsSection } from '@/components/sh/home/operations-section'

export default function SellerHubHomePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">홈</h1>
        <p className="text-sm text-muted-foreground">
          확인하고 조치할 항목을 한눈에 보고 바로 작업으로 이동하세요
        </p>
      </div>

      <OnboardingProgressCard />

      <HomeSection title="판매">
        <SalesSummaryCard />
        <ProductRankingCard />
        <ChannelStockCard />
      </HomeSection>

      <HomeSection title="재고">
        <StockAlertsCard />
        <StockAdjustmentCard />
        <ReorderStatusCard />
      </HomeSection>

      <HomeSection title="배송">
        <ShippingTodayCard />
        <ShippingUnprocessedCard />
      </HomeSection>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight text-foreground">운영</h2>
        <OperationsSection />
      </section>
    </div>
  )
}
