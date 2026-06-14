'use client'

import { PricingQuickFlow } from '@/components/sh/products/pricing-sim/pricing-quick-flow'

export default function PricingSimPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">가격 시뮬레이션</h1>
        <p className="text-sm text-muted-foreground">
          상품을 묶고 비용·프로모션을 조합해 판매채널별 적정 판매가와 마진을 계산합니다. 설정에서
          비용 기본값·VAT·반품률을 조정할 수 있습니다.
        </p>
      </div>
      {/* 상품·번들 가격 시뮬레이터 — 가격 그룹 → 마진 계산 → 판매채널 상품 생성 핸드오프 */}
      <PricingQuickFlow />
    </div>
  )
}
