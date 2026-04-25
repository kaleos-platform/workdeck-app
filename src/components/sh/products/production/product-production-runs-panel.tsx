'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
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
import { SELLER_HUB_PRODUCTION_PATH, getSellerHubProductionRunPath } from '@/lib/deck-routes'

type ProductionRunForProduct = {
  id: string
  runNo: string
  orderedAt: string
  totalCost: number | null
  costMode: 'TOTAL' | 'BREAKDOWN'
  totalQuantity: number
  itemCount: number
  averageUnitCost: number | null
  myItems: Array<{ optionId: string; optionName: string; quantity: number }>
  updatedAt: string
}

type Props = {
  productId: string
}

export function ProductProductionRunsPanel({ productId }: Props) {
  const [rows, setRows] = useState<ProductionRunForProduct[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/sh/products/${productId}/production-runs`)
        if (!res.ok) throw new Error('조회 실패')
        const data: { data: ProductionRunForProduct[] } = await res.json()
        if (!cancelled) setRows(data.data ?? [])
      } catch {
        if (!cancelled) setRows([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [productId])

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-10 text-center">
        <p className="text-sm text-muted-foreground">이 상품은 아직 등록된 생산 차수가 없습니다</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href={SELLER_HUB_PRODUCTION_PATH}>
            <Plus className="mr-1 h-4 w-4" />
            생산 차수 추가
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
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
              <TableHead>발주일</TableHead>
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
                .map((i) => `${i.optionName} ×${i.quantity}`)
                .join(' · ')
              return (
                <TableRow key={r.id} className="hover:bg-muted/40">
                  <TableCell className="font-mono text-sm">{r.runNo}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(r.orderedAt).toLocaleDateString('ko-KR')}
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
                    <Link
                      href={getSellerHubProductionRunPath(r.id)}
                      aria-label={`${r.runNo} 상세`}
                      className="inline-flex text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
