'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Truck, ArrowRight, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { SELLER_HUB_SHIPPING_REGISTRATION_PATH } from '@/lib/deck-routes'

type ShippingTodayData = {
  draftBatchCount: number
  draftOrderCount: number
  completedTodayCount: number
}

type KpiItem = {
  label: string
  value: string
  highlight?: boolean
}

export function ShippingTodayCard() {
  const [data, setData] = useState<ShippingTodayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/sh/dashboard/shipping-today')
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((json: ShippingTodayData) => setData(json))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  const kpis: KpiItem[] = data
    ? [
        {
          label: '미발송 배치',
          value: `${data.draftBatchCount.toLocaleString('ko-KR')}건`,
          highlight: data.draftBatchCount > 0,
        },
        {
          label: '총 주문',
          value: `${data.draftOrderCount.toLocaleString('ko-KR')}건`,
          highlight: data.draftOrderCount > 0,
        },
        {
          label: '오늘 완료',
          value: `${data.completedTodayCount.toLocaleString('ko-KR')}건`,
        },
      ]
    : []

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">오늘 배송</CardTitle>
        <Truck className="h-4 w-4 text-muted-foreground" />
      </CardHeader>

      <CardContent className="pb-2">
        {loading ? (
          <div className="grid grid-cols-3 gap-4" aria-busy="true" aria-label="로딩 중">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-7 w-14 animate-pulse rounded bg-muted" />
                <div className="h-3 w-16 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-4 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>데이터를 불러오지 못했습니다.</span>
          </div>
        ) : (
          <dl className="grid grid-cols-3 gap-4" aria-label="오늘 배송 현황">
            {kpis.map((kpi) => (
              <div key={kpi.label}>
                <dt className="text-xs text-muted-foreground">{kpi.label}</dt>
                <dd
                  className={`mt-0.5 text-2xl font-bold tabular-nums ${
                    kpi.highlight ? 'text-orange-500' : ''
                  }`}
                >
                  {kpi.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>

      <CardFooter className="pt-2">
        <Link
          href={SELLER_HUB_SHIPPING_REGISTRATION_PATH}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          aria-label="배송 등록 페이지로 이동"
        >
          배송 → 배송 등록
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardFooter>
    </Card>
  )
}
