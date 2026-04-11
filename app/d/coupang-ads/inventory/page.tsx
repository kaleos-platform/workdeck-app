'use client'

import { useState, useCallback } from 'react'
import { InventorySummaryCards } from '@/components/inventory/inventory-summary-cards'
import { InventoryAnalysisPanel } from '@/components/inventory/inventory-analysis-panel'
import { InventoryTable } from '@/components/inventory/inventory-table'
import { InventoryUploadForm } from '@/components/inventory/inventory-upload-form'

export default function InventoryPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [summaryKey, setSummaryKey] = useState(0)

  // 업로드 완료 → 요약 + 테이블 모두 리마운트
  const handleUploadComplete = useCallback(() => {
    setRefreshKey((k) => k + 1)
    setSummaryKey((k) => k + 1)
  }, [])

  // 제외/복원 → 요약 카드만 갱신 (테이블은 로컬 상태 유지)
  const handleExcludeChange = useCallback(() => {
    setSummaryKey((k) => k + 1)
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">로켓그로스 재고 관리</h1>
          <p className="text-sm text-muted-foreground">
            쿠팡 로켓그로스 재고 현황 및 상품 판매 성과를 관리합니다.
          </p>
        </div>
        <InventoryUploadForm onUploadComplete={handleUploadComplete} />
      </div>

      <InventorySummaryCards key={`summary-${summaryKey}`} />
      <InventoryAnalysisPanel key={`analysis-${summaryKey}`} />
      <InventoryTable key={`table-${refreshKey}`} onExcludeChange={handleExcludeChange} />
    </div>
  )
}
