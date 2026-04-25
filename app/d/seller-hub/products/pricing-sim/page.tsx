'use client'

import { PricingSimMain } from '@/components/sh/products/pricing-sim/pricing-sim-main'

export default function PricingSimPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">가격 시뮬레이션</h1>
        <p className="text-sm text-muted-foreground">
          옵션을 선택하고 비용 변수를 조합해 순수익을 계산합니다. 시나리오를 저장하면 다른 가격
          전략과 비교할 수 있습니다.
        </p>
      </div>
      <PricingSimMain />
    </div>
  )
}
