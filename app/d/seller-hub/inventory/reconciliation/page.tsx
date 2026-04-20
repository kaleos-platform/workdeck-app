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

  function handleConfirmed() {
    setPreviewId(null)
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">재고 일괄 조정</h1>
          <p className="text-sm text-muted-foreground">
            실제 재고 파일을 업로드하여 시스템 재고와 대조하고, 차이를 일괄 반영합니다
          </p>
        </div>
        <ReconciliationUpload onUploaded={handleUploaded} />
      </div>

      <div className="flex gap-4">
        <div className="w-80 shrink-0">
          <ReconciliationHistory
            refreshKey={refreshKey}
            onSelect={setPreviewId}
            selectedId={previewId}
          />
        </div>
        <div className="min-w-0 flex-1">
          {previewId ? (
            <ReconciliationPreview
              reconciliationId={previewId}
              onClose={() => setPreviewId(null)}
              onConfirmed={handleConfirmed}
            />
          ) : (
            <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
              왼쪽 목록에서 파일을 선택하세요
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
