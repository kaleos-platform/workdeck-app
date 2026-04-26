'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Package, ArrowRight, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { SELLER_HUB_REORDER_PATH } from '@/lib/deck-routes'

type ReorderOptionRow = {
  productId: string
  productName: string
  productCode: string | null
  optionId: string
  currentStock: number
  estimatedDepletionDays: number | null
  isUrgent: boolean
}

type ProductAlert = {
  productId: string
  productName: string
  productCode: string | null
  optionCount: number
  currentStock: number
  estimatedDepletionDays: number | null
}

function aggregateByProduct(rows: ReorderOptionRow[]): ProductAlert[] {
  const map = new Map<string, ProductAlert>()
  for (const r of rows) {
    const existing = map.get(r.productId)
    if (!existing) {
      map.set(r.productId, {
        productId: r.productId,
        productName: r.productName,
        productCode: r.productCode,
        optionCount: 1,
        currentStock: r.currentStock,
        estimatedDepletionDays: r.estimatedDepletionDays,
      })
    } else {
      existing.optionCount += 1
      existing.currentStock += r.currentStock
      // 최소 소진일(가장 긴급한 옵션) 기준
      if (
        r.estimatedDepletionDays !== null &&
        (existing.estimatedDepletionDays === null ||
          r.estimatedDepletionDays < existing.estimatedDepletionDays)
      ) {
        existing.estimatedDepletionDays = r.estimatedDepletionDays
      }
    }
  }
  return Array.from(map.values())
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
  const [rawRows, setRawRows] = useState<ReorderOptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/sh/inventory/reorder?reorderNeededOnly=true')
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((data: { data: ReorderOptionRow[] }) => setRawRows(data.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  const topProducts = useMemo(() => {
    const aggregated = aggregateByProduct(rawRows)
    aggregated.sort((a, b) => {
      if (a.estimatedDepletionDays === null && b.estimatedDepletionDays === null) return 0
      if (a.estimatedDepletionDays === null) return 1
      if (b.estimatedDepletionDays === null) return -1
      return a.estimatedDepletionDays - b.estimatedDepletionDays
    })
    return aggregated.slice(0, 5)
  }, [rawRows])

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
        ) : topProducts.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            재고 경고 항목이 없습니다.
          </p>
        ) : (
          <ul className="space-y-2.5" role="list" aria-label="재고 경고 목록">
            {topProducts.map((row) => (
              <li key={row.productId} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm leading-tight font-medium">{row.productName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.productCode ?? `옵션 ${row.optionCount}개`}
                  </p>
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
