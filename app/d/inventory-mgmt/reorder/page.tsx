'use client'

import { ReorderTable } from '@/components/inv/reorder-table'

export default function ReorderPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">발주 예측</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          과거 출고 이력과 현재 재고, 리드타임·안전재고 설정을 바탕으로 옵션별 발주 필요량을 계산합니다.
        </p>
      </div>
      <ReorderTable />
    </div>
  )
}
