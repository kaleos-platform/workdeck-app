'use client'

import { useState } from 'react'
import { BatchList } from '@/components/del/batch-list'
import { OrderDetailTable } from '@/components/del/order-detail-table'

export default function DeliveryOrdersPage() {
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">주문 데이터 관리</h1>
      <div className="flex gap-4">
        <div className="w-80 shrink-0">
          <BatchList onSelect={setSelectedBatchId} selectedBatchId={selectedBatchId} />
        </div>
        <div className="flex-1 min-w-0">
          {selectedBatchId ? (
            <OrderDetailTable batchId={selectedBatchId} />
          ) : (
            <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
              왼쪽 목록에서 배치를 선택하세요
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
