'use client'

import { PricingSimMain } from '@/components/sh/products/pricing-sim/pricing-sim-main'
import { PricingQuickFlow } from '@/components/sh/products/pricing-sim/pricing-quick-flow'

export default function PricingSimPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">가격 시뮬레이션</h1>
        <p className="text-sm text-muted-foreground">
          옵션을 선택하고 비용 변수를 조합해 순수익을 계산합니다. 시나리오를 저장하면 다른 가격
          전략과 비교할 수 있습니다.
        </p>
      </div>
      {/* 빠른 적정가 (베타) — 가격 그룹 → 마진 계산 → 판매채널 상품 생성 핸드오프 */}
      <PricingQuickFlow />
      <PricingSimMain />
    </div>
  )
}
