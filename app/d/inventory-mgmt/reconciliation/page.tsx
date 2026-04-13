'use client'

import { useState } from 'react'
import { ReconciliationUpload } from '@/components/inv/reconciliation-upload'
import { ReconciliationHistory } from '@/components/inv/reconciliation-history'
import { ReconciliationPreview } from '@/components/inv/reconciliation-preview'

export default function ReconciliationPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [previewId, setPreviewId] = useState<string | null>(null)

  function handleUploaded(id: string) {
    setRefreshKey((k) => k + 1)
    setPreviewId(id)
  }

  function handleClose() {
    setPreviewId(null)
  }

  function handleConfirmed() {
    setPreviewId(null)
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">파일 기반 재고 대조</h1>
          <p className="text-sm text-muted-foreground">
            실제 재고 파일을 업로드하여 시스템 재고와 대조하고, 차이를
            ADJUSTMENT 이동으로 일괄 반영합니다.
          </p>
        </div>
        <ReconciliationUpload onUploaded={handleUploaded} />
      </div>

      {previewId ? (
        <ReconciliationPreview
          reconciliationId={previewId}
          onClose={handleClose}
          onConfirmed={handleConfirmed}
        />
      ) : (
        <ReconciliationHistory
          refreshKey={refreshKey}
          onSelect={setPreviewId}
        />
      )}
    </div>
  )
}
