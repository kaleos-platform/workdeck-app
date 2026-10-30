'use client'

import { useEffect, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { SalesMixProductDetail } from '@/lib/coupang-ads/sales-mix-query'
import { fmtWon } from './sales-mix-table'

const fmtAxisWon = (v: number) =>
  Math.abs(v) >= 10000 ? `${Math.round(v / 10000).toLocaleString('ko-KR')}만` : `${v}`

export function SalesMixProductPanel({
  product,
  from,
  to,
  onClose,
}: {
  product: { productId: string; productName: string } | null
  from: string
  to: string
  onClose: () => void
}) {
  const productId = product?.productId ?? null
  const key = productId ? `${productId}|${from}|${to}` : null
  const [result, setResult] = useState<{
    key: string
    detail: SalesMixProductDetail | null
  } | null>(null)
  const detail = result?.key === key ? result.detail : undefined

  useEffect(() => {
    if (!key || !productId) return
    const controller = new AbortController()
    const params = new URLSearchParams({ startDate: from, endDate: to, productId })
    fetch(`/api/coupang-ads/sales-mix?${params}`, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<SalesMixProductDetail>) : null))
      .then((d) => {
        if (!controller.signal.aborted) setResult({ key, detail: d })
      })
      .catch(() => {
        // 취소·네트워크 실패 — 실패 문구로 표시
        if (!controller.signal.aborted) setResult({ key, detail: null })
      })
    return () => controller.abort()
  }, [key, productId, from, to])

  return (
    <Sheet open={!!product} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{product?.productName}</SheetTitle>
          <SheetDescription>
            {from} ~ {to}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          {detail === undefined ? (
            <p className="text-sm text-muted-foreground">불러오는 중…</p>
          ) : detail === null ? (
            <p className="text-sm text-muted-foreground">상세 데이터를 불러오지 못했습니다</p>
          ) : (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">일별 매출 · 광고비</h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={detail.daily}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d: string) => d.slice(5).replace('-', '/')}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis tickFormatter={fmtAxisWon} tick={{ fontSize: 11 }} width={48} />
                      <Tooltip formatter={(v) => fmtWon(Number(v))} />
                      <Bar dataKey="revenue" name="전체 매출" fill="#a1a1aa" />
                      <Line
                        dataKey="adCost"
                        name="광고비"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">옵션별 매출 · 수량</h3>
                <p className="text-xs text-muted-foreground">
                  광고비는 옵션 단위로 귀속하지 않습니다.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>옵션</TableHead>
                      <TableHead className="text-right">전체 매출</TableHead>
                      <TableHead className="text-right">판매수량</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.options.map((o) => (
                      <TableRow key={o.optionId}>
                        <TableCell className="whitespace-normal">
                          {o.optionName ?? o.optionId}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtWon(o.revenue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {o.salesQty.toLocaleString('ko-KR')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
