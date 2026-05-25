'use client'

import { use } from 'react'
import { ReorderPlanDetail } from '@/components/sh/inventory/reorder-plan-detail'

type Props = {
  params: Promise<{ planId: string }>
}

export default function ReorderPlanDetailPage({ params }: Props) {
  const { planId } = use(params)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">발주 계획 상세</h1>
        <p className="text-sm text-muted-foreground">
          옵션별 예측 수량을 확인하고 최종 발주 수량을 조정합니다
        </p>
      </div>
      <ReorderPlanDetail planId={planId} />
    </div>
  )
}
