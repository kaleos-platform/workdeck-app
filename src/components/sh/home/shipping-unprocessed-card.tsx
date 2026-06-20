'use client'

import { PackageX } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SELLER_HUB_SHIPPING_ORDERS_PATH } from '@/lib/deck-routes'
import {
  CardError,
  CardEmpty,
  CardListSkeleton,
  CardFooterLink,
  useCardData,
} from './card-primitives'

type ShippingUnprocessed = {
  staleDraftBatchCount: number // 오래된 미발송 배치
  unmatchedItemCount: number // 매칭 실패 주문 라인
  staleDraftDays: number
}

export function ShippingUnprocessedCard() {
  const { data, loading, error } = useCardData<ShippingUnprocessed>(
    '/api/sh/dashboard/shipping-unprocessed'
  )

  const rows = data
    ? [
        {
          label: `${data.staleDraftDays}일 이상 미발송 배치`,
          count: data.staleDraftBatchCount,
          tone: 'warn' as const,
        },
        { label: '상품 매칭 실패 항목', count: data.unmatchedItemCount, tone: 'danger' as const },
      ]
    : []
  const hasIssue = rows.some((r) => r.count > 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">배송 미처리</CardTitle>
        <PackageX className="h-4 w-4 text-muted-foreground" />
      </CardHeader>

      <CardContent className="pb-2">
        {loading ? (
          <CardListSkeleton rows={3} />
        ) : error || !data ? (
          <CardError />
        ) : !hasIssue ? (
          <CardEmpty>미처리 배송 항목이 없습니다.</CardEmpty>
        ) : (
          <ul className="space-y-2" role="list" aria-label="배송 미처리 항목">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-foreground">{r.label}</span>
                <span
                  className={`shrink-0 font-semibold tabular-nums ${
                    r.count === 0
                      ? 'text-muted-foreground'
                      : r.tone === 'danger'
                        ? 'text-destructive'
                        : 'text-orange-500'
                  }`}
                >
                  {r.count.toLocaleString('ko-KR')}건
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <CardFooterLink href={SELLER_HUB_SHIPPING_ORDERS_PATH} label="배송 데이터" />
    </Card>
  )
}
