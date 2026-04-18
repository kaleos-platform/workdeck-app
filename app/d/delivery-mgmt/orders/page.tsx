'use client'

import { useEffect, useState } from 'react'
import { BatchList } from '@/components/del/batch-list'
import { OrderDetailTable } from '@/components/del/order-detail-table'

type ShippingMethod = { id: string; name: string }

export default function DeliveryOrdersPage() {
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([])

  useEffect(() => {
    fetch('/api/del/shipping-methods?isActive=true')
      .then((r) => r.json())
      .then((data) => setShippingMethods(data.methods ?? []))
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">주문 데이터 관리</h1>

      <div className="rounded-lg border bg-card p-3">
        <BatchList onSelect={setSelectedBatchId} selectedBatchId={selectedBatchId} />
      </div>

      <div className="min-w-0">
        {selectedBatchId ? (
          <OrderDetailTable batchId={selectedBatchId} shippingMethods={shippingMethods} />
        ) : (
          <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
            위 목록에서 배송 묶음을 선택하세요
          </div>
        )}
      </div>
    </div>
  )
}
