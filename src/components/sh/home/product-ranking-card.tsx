'use client'

import { BarChart3, TrendingDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SELLER_HUB_SALES_ANALYTICS_PATH } from '@/lib/deck-routes'
import {
  CardError,
  CardEmpty,
  CardListSkeleton,
  CardFooterLink,
  useCardData,
} from './card-primitives'

type RankRow = { productId: string; productName: string; orderCount: number; salesQty: number }
type ProductRanking = { top: RankRow[]; bottom: RankRow[] }

function RankList({ rows, emptyText }: { rows: RankRow[]; emptyText: string }) {
  if (rows.length === 0) return <CardEmpty>{emptyText}</CardEmpty>
  return (
    <ul className="space-y-1.5" role="list">
      {rows.map((r) => (
        <li key={r.productId} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate text-foreground">{r.productName}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {r.orderCount.toLocaleString('ko-KR')}건
          </span>
        </li>
      ))}
    </ul>
  )
}

export function ProductRankingCard() {
  const { data, loading, error } = useCardData<ProductRanking>('/api/sh/dashboard/product-ranking')

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">상품 현황 (최근 30일)</CardTitle>
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
      </CardHeader>

      <CardContent className="pb-2">
        {loading ? (
          <CardListSkeleton rows={4} />
        ) : error || !data ? (
          <CardError />
        ) : (
          <div className="space-y-4">
            <div>
              <p className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <BarChart3 className="h-3 w-3" /> 판매 상위 (주문 많은 순)
              </p>
              <RankList rows={data.top} emptyText="최근 30일 판매 데이터가 없습니다." />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                주문 건수는 직접배송 채널 기준입니다.
              </p>
            </div>
            <div className="border-t pt-3">
              <p className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <TrendingDown className="h-3 w-3" /> 판매 부진 (주문 없는 순)
              </p>
              <RankList rows={data.bottom} emptyText="부진 상품이 없습니다." />
            </div>
          </div>
        )}
      </CardContent>

      <CardFooterLink href={SELLER_HUB_SALES_ANALYTICS_PATH} label="판매분석" />
    </Card>
  )
}
