'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ProductApplyPatch } from '@/components/sh/products/product-basic-form'
import { ProductExtractSourceForm } from './product-extract-source-form'
import { ProductExtractReview } from './product-extract-review'
import { ProductExtractHistory } from './product-extract-history'
import type { ExtractJob } from './types'

type Props = {
  productId: string
  /** 기본 정보 폼이 dirty/저장 중이면 true — 적용 버튼을 잠그는 데 쓴다 */
  basicBusy: boolean
  /** 기본 정보 폼 state에 값을 주입하고 그 결과 autosave가 성공할 때까지 기다리는 핸들 */
  onApply: (patch: ProductApplyPatch) => Promise<void>
}

/**
 * AI 상품정보 추출 섹션 컨테이너 — 소재 입력, 방금 만든/재열람한 잡의 검토, 이력을 묶는다.
 * 실제 InvProduct 반영은 이 패널이 직접 하지 않고 항상 onApply를 통해 기본 정보 폼으로 흘려보낸다.
 */
export function ProductExtractPanel({ productId, basicBusy, onApply }: Props) {
  const [jobs, setJobs] = useState<ExtractJob[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [activeJob, setActiveJob] = useState<ExtractJob | null>(null)

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const res = await fetch(`/api/sh/products/${productId}/extract`)
      if (!res.ok) return
      const data = await res.json()
      setJobs(data.jobs ?? [])
    } finally {
      setLoadingHistory(false)
    }
  }, [productId])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const handleCreated = useCallback(
    (job: ExtractJob) => {
      setActiveJob(job)
      void loadHistory()
    },
    [loadHistory]
  )

  return (
    <div className="space-y-6">
      <ProductExtractSourceForm productId={productId} onCreated={handleCreated} />

      {activeJob && (
        <ProductExtractReview
          productId={productId}
          job={activeJob}
          basicBusy={basicBusy}
          onApply={onApply}
          onApplied={loadHistory}
          onClose={() => setActiveJob(null)}
        />
      )}

      <ProductExtractHistory
        productId={productId}
        jobs={jobs}
        loading={loadingHistory}
        basicBusy={basicBusy}
        onApply={onApply}
        onReopen={setActiveJob}
        onChanged={loadHistory}
      />
    </div>
  )
}
