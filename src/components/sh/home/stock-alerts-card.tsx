'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Package, ArrowRight, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { SELLER_HUB_REORDER_PATH } from '@/lib/deck-routes'

type ReorderRow = {
  optionId: string
  productName: string
  optionName: string
  currentStock: number
  estimatedDepletionDays: number | null
  isUrgent: boolean
}

function DepletionBadge({ days }: { days: number | null }) {
  if (days === null) {
    return <span className="text-xs text-muted-foreground">소진일 미산출</span>
  }
  const date = new Date()
  date.setDate(date.getDate() + days)
  const label = date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
  const colorClass =
    days <= 7
      ? 'text-destructive font-semibold'
      : days <= 14
        ? 'text-orange-500 font-medium'
        : 'text-muted-foreground'
  return <span className={`text-xs ${colorClass}`}>{label} 소진 예상</span>
}

export function StockAlertsCard() {
  const [rows, setRows] = useState<ReorderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/sh/inventory/reorder?reorderNeededOnly=true')
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((data: { data: ReorderRow[] }) => {
        // 소진 예상일 기준 오름차순, null은 마지막
        const sorted = [...data.data].sort((a, b) => {
          if (a.estimatedDepletionDays === null && b.estimatedDepletionDays === null) return 0
          if (a.estimatedDepletionDays === null) return 1
          if (b.estimatedDepletionDays === null) return -1
          return a.estimatedDepletionDays - b.estimatedDepletionDays
        })
        setRows(sorted.slice(0, 5))
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">재고 경고</CardTitle>
        <Package className="h-4 w-4 text-muted-foreground" />
      </CardHeader>

      <CardContent className="pb-2">
        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="로딩 중">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-4 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>데이터를 불러오지 못했습니다.</span>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            재고 경고 항목이 없습니다.
          </p>
        ) : (
          <ul className="space-y-2.5" role="list" aria-label="재고 경고 목록">
            {rows.map((row) => (
              <li key={row.optionId} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm leading-tight font-medium">{row.productName}</p>
                  <p className="truncate text-xs text-muted-foreground">{row.optionName}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {row.currentStock.toLocaleString('ko-KR')}개
                  </p>
                  <DepletionBadge days={row.estimatedDepletionDays} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <CardFooter className="pt-2">
        <Link
          href={SELLER_HUB_REORDER_PATH}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          aria-label="재고 관리 발주 예측 페이지로 이동"
        >
          재고 관리 → 발주 예측
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardFooter>
    </Card>
  )
}
