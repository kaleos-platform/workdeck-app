'use client'

import { ClipboardList } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SELLER_HUB_REORDER_PATH } from '@/lib/deck-routes'
import {
  CardError,
  CardEmpty,
  CardListSkeleton,
  CardFooterLink,
  useCardData,
} from './card-primitives'

type ReorderStatus = {
  draftPlanCount: number
  draftSamples: Array<{ planId: string; planNo: string; productName: string }>
  eligiblePlanCount: number // 정산 대기 (점검 가능)
  measuredPlanCount: number // 정산 완료 (결과 확인)
}

export function ReorderStatusCard() {
  const { data, loading, error } = useCardData<ReorderStatus>('/api/sh/dashboard/reorder-status')

  const hasContent = data
    ? data.draftPlanCount > 0 || data.eligiblePlanCount > 0 || data.measuredPlanCount > 0
    : false

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">발주 계획</CardTitle>
        <ClipboardList className="h-4 w-4 text-muted-foreground" />
      </CardHeader>

      <CardContent className="pb-2">
        {loading ? (
          <CardListSkeleton rows={3} />
        ) : error || !data ? (
          <CardError />
        ) : !hasContent ? (
          <CardEmpty>처리할 발주 계획이 없습니다.</CardEmpty>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-foreground">초안 작성 대기</span>
              <span
                className={`font-semibold tabular-nums ${
                  data.draftPlanCount > 0 ? 'text-orange-500' : 'text-muted-foreground'
                }`}
              >
                {data.draftPlanCount.toLocaleString('ko-KR')}건
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-foreground">예측 점검 대기</span>
              <span
                className={`font-semibold tabular-nums ${
                  data.eligiblePlanCount > 0 ? 'text-orange-500' : 'text-muted-foreground'
                }`}
              >
                {data.eligiblePlanCount.toLocaleString('ko-KR')}건
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-foreground">점검 결과 확인</span>
              <span className="font-semibold text-muted-foreground tabular-nums">
                {data.measuredPlanCount.toLocaleString('ko-KR')}건
              </span>
            </div>

            {data.draftSamples.length > 0 && (
              <ul className="space-y-1 border-t pt-2" aria-label="초안 발주 계획">
                {data.draftSamples.map((s) => (
                  <li
                    key={s.planId}
                    className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span className="truncate">{s.productName}</span>
                    <span className="shrink-0 tabular-nums">{s.planNo}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>

      <CardFooterLink href={SELLER_HUB_REORDER_PATH} label="발주 계획" />
    </Card>
  )
}
