'use client'

import { TrendingUp, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getDeltaColor } from '@/lib/delta-color'
import { formatKRW } from '@/lib/sh/sales-analytics'
import { SELLER_HUB_SALES_ANALYTICS_PATH } from '@/lib/deck-routes'
import { CardError, CardFooterLink, useCardData } from './card-primitives'

type Metric = { current: number; prev: number; pctChange: number | null }
type BrandRow = {
  brandId: string | null
  brandName: string
  orderCount: number
  orderPctChange: number | null
  salesQty: number
}
type SalesSummary = {
  totalRevenue: Metric
  totalOrders: Metric
  recent30Days: { revenue: number; orderCount: number }
  byBrand: BrandRow[]
}

/**
 * 증감 배지 — 화살표 + %. 지난달 동기간 대비.
 * @param label 퍼센트 뒤 붙는 설명(예: "지난달 동기간"). 생략 시 화살표+% 만.
 * @param nullLabel pct 가 null 일 때 표시(생략 시 "–").
 */
function DeltaBadge({
  pct,
  label,
  nullLabel = '–',
}: {
  pct: number | null
  label?: string
  nullLabel?: string
}) {
  const color = getDeltaColor(pct)
  if (pct === null) {
    return <span className="text-xs text-muted-foreground">{nullLabel}</span>
  }
  const Icon = pct > 0 ? ArrowUp : pct < 0 ? ArrowDown : Minus
  const sign = pct > 0 ? '+' : ''
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${color}`}>
      <Icon className="h-3 w-3" />
      {sign}
      {pct}%{label ? <span className="text-muted-foreground"> {label}</span> : null}
    </span>
  )
}

export function SalesSummaryCard() {
  const { data, loading, error } = useCardData<SalesSummary>('/api/sh/dashboard/sales-summary')

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">판매 요약</CardTitle>
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
      </CardHeader>

      <CardContent className="pb-2">
        {loading ? (
          <div className="space-y-4" aria-busy="true" aria-label="로딩 중">
            <div className="grid grid-cols-2 gap-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                  <div className="h-7 w-24 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          </div>
        ) : error || !data ? (
          <CardError />
        ) : (
          <div className="space-y-4">
            {/* 전체 매출·주문 (이번달 MTD) */}
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-xs text-muted-foreground">이번 달 매출</dt>
                <dd className="mt-0.5 text-2xl font-bold tabular-nums">
                  {formatKRW(data.totalRevenue.current)}
                </dd>
                <DeltaBadge
                  pct={data.totalRevenue.pctChange}
                  label="지난달 동기간"
                  nullLabel="지난달 비교 불가"
                />
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">이번 달 주문</dt>
                <dd className="mt-0.5 text-2xl font-bold tabular-nums">
                  {data.totalOrders.current.toLocaleString('ko-KR')}건
                </dd>
                <DeltaBadge
                  pct={data.totalOrders.pctChange}
                  label="지난달 동기간"
                  nullLabel="지난달 비교 불가"
                />
              </div>
            </dl>

            {/* 최근 30일 보조 지표 (상품 현황 카드와 같은 윈도우) */}
            <dl className="grid grid-cols-2 gap-4 border-t pt-3">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-xs text-muted-foreground">최근 30일 매출</dt>
                <dd className="text-sm font-semibold tabular-nums">
                  {formatKRW(data.recent30Days.revenue)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-xs text-muted-foreground">최근 30일 주문</dt>
                <dd className="text-sm font-semibold tabular-nums">
                  {data.recent30Days.orderCount.toLocaleString('ko-KR')}건
                </dd>
              </div>
            </dl>

            {/* 브랜드별 주문·판매량 */}
            {data.byBrand.length > 0 && (
              <div className="border-t pt-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  브랜드별 주문 (직접배송)
                </p>
                <ul className="space-y-1.5" aria-label="브랜드별 주문 현황">
                  {data.byBrand.slice(0, 4).map((b) => (
                    <li
                      key={b.brandId ?? '__none__'}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="truncate text-foreground">{b.brandName}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums">
                          {b.orderCount.toLocaleString('ko-KR')}건
                        </span>
                        <DeltaBadge pct={b.orderPctChange} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <CardFooterLink href={SELLER_HUB_SALES_ANALYTICS_PATH} label="판매분석" />
    </Card>
  )
}
