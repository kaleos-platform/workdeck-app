'use client'

import { Scale } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SELLER_HUB_RECONCILIATION_PATH } from '@/lib/deck-routes'
import {
  CardError,
  CardEmpty,
  CardListSkeleton,
  CardFooterLink,
  useCardData,
} from './card-primitives'

type InventoryHealth = {
  negativeStockCount: number
  negativeSamples: Array<{
    productName: string
    optionName: string
    locationName: string
    quantity: number
  }>
  pendingReconciliationCount: number
}

export function StockAdjustmentCard() {
  const { data, loading, error } = useCardData<InventoryHealth>(
    '/api/sh/dashboard/inventory-health'
  )

  const hasIssue = data ? data.negativeStockCount > 0 || data.pendingReconciliationCount > 0 : false

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">재고 조정</CardTitle>
        <Scale className="h-4 w-4 text-muted-foreground" />
      </CardHeader>

      <CardContent className="pb-2">
        {loading ? (
          <CardListSkeleton rows={3} />
        ) : error || !data ? (
          <CardError />
        ) : !hasIssue ? (
          <CardEmpty>재고 수치가 정상입니다.</CardEmpty>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-foreground">마이너스 재고</span>
              <span
                className={`font-semibold tabular-nums ${
                  data.negativeStockCount > 0 ? 'text-destructive' : 'text-muted-foreground'
                }`}
              >
                {data.negativeStockCount.toLocaleString('ko-KR')}건
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-foreground">조정 적용 대기</span>
              <span
                className={`font-semibold tabular-nums ${
                  data.pendingReconciliationCount > 0 ? 'text-orange-500' : 'text-muted-foreground'
                }`}
              >
                {data.pendingReconciliationCount.toLocaleString('ko-KR')}건
              </span>
            </div>

            {data.negativeSamples.length > 0 && (
              <ul className="space-y-1 border-t pt-2" aria-label="마이너스 재고 항목">
                {data.negativeSamples.map((s, i) => (
                  <li
                    key={`${s.productName}-${s.optionName}-${i}`}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="truncate text-muted-foreground">
                      {s.productName} · {s.optionName} ({s.locationName})
                    </span>
                    <span className="shrink-0 font-medium text-destructive tabular-nums">
                      {s.quantity.toLocaleString('ko-KR')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>

      <CardFooterLink href={SELLER_HUB_RECONCILIATION_PATH} label="재고 조정" />
    </Card>
  )
}
