'use client'

import { useState, useCallback } from 'react'
import { InventorySummaryCards } from '@/components/inventory/inventory-summary-cards'
import { InventoryTable } from '@/components/inventory/inventory-table'
import { InventoryUploadForm } from '@/components/inventory/inventory-upload-form'

export default function InventoryPage() {
  const [refreshKey, setRefreshKey] = useState(0)

  const handleUploadComplete = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">재고 관리</h1>
          <p className="text-sm text-muted-foreground">
            쿠팡 Wing 재고 현황 및 상품 판매 성과를 관리합니다
          </p>
        </div>
        <InventoryUploadForm onUploadComplete={handleUploadComplete} />
      </div>

      <InventorySummaryCards key={`summary-${refreshKey}`} />
      <InventoryTable key={`table-${refreshKey}`} />
    </div>
  )
}
