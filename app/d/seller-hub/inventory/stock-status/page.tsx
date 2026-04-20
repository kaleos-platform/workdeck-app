'use client'

import { StockStatusTable } from '@/components/inv/stock-status-table'

export default function StockStatusPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">재고 현황</h1>
        <p className="text-sm text-muted-foreground">
          상품 및 옵션별 재고를 위치별로 확인할 수 있습니다
        </p>
      </div>
      <StockStatusTable />
    </div>
  )
}
