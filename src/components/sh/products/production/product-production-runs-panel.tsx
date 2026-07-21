'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SELLER_HUB_PRODUCTION_PATH } from '@/lib/deck-routes'
import type { ProductionRunStatus } from '@/lib/sh/production-runs-query'
import { ProductionRunFormDialog } from './production-run-form-dialog'
import { StatusBadge } from './production-runs-table'

type MyOptionItem = {
  optionId: string
  optionName: string
  quantity: number
  stockedInQty: number | null
}

type ProductionRunForProduct = {
  id: string
  runNo: string
  status: ProductionRunStatus
  memo: string | null
  dueAt: string | null
  brand: { id: string; name: string } | null
  orderedConfirmedAt: string | null
  stockedInAt: string | null
  totalCost: number | null
  costMode: 'TOTAL' | 'BREAKDOWN'
  totalQuantity: number
  itemCount: number
  averageUnitCost: number | null
  myItems: MyOptionItem[]
  updatedAt: string
}

type Props = {
  productId: string
}

// ─── 옵션 요약 칩 (앞 2개 + 외 N개 툴팁) ──────────────────────────────────────

const MAX_OPTION_CHIPS = 2

function optionLabel(i: MyOptionItem) {
  return i.stockedInQty != null && i.stockedInQty !== i.quantity
    ? `${i.optionName} ×${i.quantity}→${i.stockedInQty}`
    : `${i.optionName} ×${i.quantity}`
}

function MyOptionChips({ items }: { items: MyOptionItem[] }) {
  if (items.length === 0) {
    return <span className="text-sm text-muted-foreground">-</span>
  }
  const visible = items.slice(0, MAX_OPTION_CHIPS)
  const rest = items.slice(MAX_OPTION_CHIPS)

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((i) => (
        <Badge
          key={i.optionId}
          variant="secondary"
          className="max-w-[160px] truncate text-xs"
        >
          {i.optionName}
        </Badge>
      ))}
      {rest.length > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="cursor-default text-xs">
                외 {rest.length}개
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <ul className="space-y-0.5 text-xs">
                {items.map((i) => (
                  <li key={i.optionId}>{optionLabel(i)}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
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
                <TableHead className="w-[110px]">차수 번호</TableHead>
                <TableHead className="w-[220px]">메모</TableHead>
                <TableHead className="w-[80px]">상태</TableHead>
                <TableHead className="w-[90px]">발주일</TableHead>
                <TableHead className="w-[90px]">입고일</TableHead>
                <TableHead className="w-[90px]">납기일</TableHead>
                <TableHead className="w-[90px]">브랜드</TableHead>
                <TableHead>이 상품 옵션</TableHead>
                <TableHead className="w-[70px] text-right">총 수량</TableHead>
                <TableHead className="w-[110px] text-right">총 원가</TableHead>
                <TableHead className="w-[100px] text-right">평균 단가</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => {
                    setEditRunId(r.id)
                    setFormOpen(true)
                  }}
                >
                  <TableCell className="font-mono text-sm">{r.runNo}</TableCell>
                  <TableCell
                    className="max-w-[220px] truncate text-sm text-muted-foreground"
                    title={r.memo ?? undefined}
                  >
                    {r.memo ?? '-'}
                  </TableCell>
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
                  <TableCell className="text-sm text-muted-foreground">
                    {r.dueAt ? new Date(r.dueAt).toLocaleDateString('ko-KR') : '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.brand?.name ?? '-'}
                  </TableCell>
                  <TableCell>
                    <MyOptionChips items={r.myItems} />
                  </TableCell>
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
                </TableRow>
              ))}
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
