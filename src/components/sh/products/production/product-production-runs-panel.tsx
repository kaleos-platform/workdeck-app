'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SELLER_HUB_PRODUCTION_PATH } from '@/lib/deck-routes'
import type { ProductionRunStatus } from '@/lib/sh/production-runs-query'
import { ProductionRunFormDialog } from './production-run-form-dialog'
import { StatusBadge } from './production-runs-table'

type ProductionRunForProduct = {
  id: string
  runNo: string
  status: ProductionRunStatus
  orderedConfirmedAt: string | null
  stockedInAt: string | null
  totalCost: number | null
  costMode: 'TOTAL' | 'BREAKDOWN'
  totalQuantity: number
  itemCount: number
  averageUnitCost: number | null
  myItems: Array<{
    optionId: string
    optionName: string
    quantity: number
    stockedInQty: number | null
  }>
  updatedAt: string
}

type Props = {
  productId: string
}

export function ProductProductionRunsPanel({ productId }: Props) {
  const [rows, setRows] = useState<ProductionRunForProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editRunId, setEditRunId] = useState<string | null>(null) // null = 신규 추가

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/products/${productId}/production-runs`)
      if (!res.ok) throw new Error('조회 실패')
      const data: { data: ProductionRunForProduct[] } = await res.json()
      setRows(data.data ?? [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  if (rows.length === 0) {
    return (
      <>
        <div className="rounded-md border border-dashed py-10 text-center">
          <p className="text-sm text-muted-foreground">
            이 상품은 아직 등록된 생산 차수가 없습니다
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setEditRunId(null)
              setFormOpen(true)
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            생산 차수 추가
          </Button>
        </div>
        <ProductionRunFormDialog
          open={formOpen}
          onOpenChange={(o) => {
            setFormOpen(o)
            if (!o) setEditRunId(null)
          }}
          runId={editRunId ?? undefined}
          onSaved={() => {
            setFormOpen(false)
            setEditRunId(null)
            load()
          }}
        />
      </>
    )
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditRunId(null)
              setFormOpen(true)
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            생산 차수 추가
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={SELLER_HUB_PRODUCTION_PATH}>
              생산 관리에서 보기
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>차수 번호</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>발주일</TableHead>
                <TableHead>입고일</TableHead>
                <TableHead>이 상품 옵션</TableHead>
                <TableHead className="text-right">총 수량</TableHead>
                <TableHead className="text-right">총 원가</TableHead>
                <TableHead className="text-right">평균 단가</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const myComposition = r.myItems
                  .map((i) =>
                    i.stockedInQty != null && i.stockedInQty !== i.quantity
                      ? `${i.optionName} ×${i.quantity}→${i.stockedInQty}`
                      : `${i.optionName} ×${i.quantity}`
                  )
                  .join(' · ')
                return (
                  <TableRow key={r.id} className="hover:bg-muted/40">
                    <TableCell className="font-mono text-sm">{r.runNo}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.orderedConfirmedAt
                        ? new Date(r.orderedConfirmedAt).toLocaleDateString('ko-KR')
                        : '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.stockedInAt ? new Date(r.stockedInAt).toLocaleDateString('ko-KR') : '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{myComposition}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.totalQuantity.toLocaleString('ko-KR')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.totalCost != null ? `${r.totalCost.toLocaleString('ko-KR')}원` : '-'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {r.averageUnitCost != null
                        ? `${Math.round(r.averageUnitCost).toLocaleString('ko-KR')}원`
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => {
                          setEditRunId(r.id)
                          setFormOpen(true)
                        }}
                        aria-label={`${r.runNo} 수정`}
                        className="inline-flex text-muted-foreground hover:text-foreground"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
      <ProductionRunFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditRunId(null)
        }}
        runId={editRunId ?? undefined}
        onSaved={() => {
          setFormOpen(false)
          setEditRunId(null)
          load()
        }}
      />
    </>
  )
}
