'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { DashboardFilterValues } from './dashboard-filters'

type StockRow = {
  productName: string
  optionName: string
  stock: number
  outbound90d: number
}

type StockResponse = {
  data: StockRow[]
  total: number
  page: number
  pageSize: number
}

interface Props {
  filters: DashboardFilterValues
}

const PAGE_SIZE = 20

export function DashboardStockTable({ filters }: Props) {
  const [data, setData] = useState<StockResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [filters])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (filters.locationId) p.set('locationId', filters.locationId)
      const res = await fetch(`/api/sh/inventory/dashboard/stock-by-product?${p}`)
      if (res.ok) {
        setData(await res.json())
      }
    } finally {
      setLoading(false)
    }
  }, [page, filters.locationId])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const totalPages = useMemo(() => Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE)), [data])

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <p className="text-sm font-semibold">상품별 재고 현황</p>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>상품명</TableHead>
                <TableHead>옵션명</TableHead>
                <TableHead className="text-right">재고</TableHead>
                <TableHead className="text-right">최근 90일 출고</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !data ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    불러오는 중...
                  </TableCell>
                </TableRow>
              ) : !data || data.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    상품 데이터가 없습니다
                  </TableCell>
                </TableRow>
              ) : (
                data.data.map((row, i) => (
                  <TableRow key={`${row.productName}-${row.optionName}-${i}`}>
                    <TableCell className="font-medium">{row.productName}</TableCell>
                    <TableCell className="text-muted-foreground">{row.optionName}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${row.stock < 0 ? 'text-red-600' : ''}`}
                    >
                      {row.stock.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.outbound90d.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {page} / {totalPages} 페이지
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                이전
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                다음
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
