'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SELLER_HUB_PRODUCTION_PATH } from '@/lib/deck-routes'

type ProductionRunStatus = 'PLANNED' | 'ORDERED' | 'STOCKED_IN'

const STATUS_LABEL: Record<ProductionRunStatus, string> = {
  PLANNED: '계획중',
  ORDERED: '발주완료',
  STOCKED_IN: '입고완료',
}

type RunDetail = {
  id: string
  runNo: string
  status: ProductionRunStatus
  brand: { id: string; name: string } | null
  dueAt: string | null
  completedAt: string | null
  orderedConfirmedAt: string | null
  stockedInAt: string | null
  totalCost: number | null
  costMode: 'TOTAL' | 'BREAKDOWN'
  memo: string | null
  items: Array<{
    id: string
    optionId: string
    optionName: string
    optionDeleted: boolean
    sku: string | null
    productId: string
    productName: string
    productOfficialName: string
    brandName: string | null
    quantity: number
  }>
  costs: Array<{
    id: string
    itemName: string
    description: string | null
    spec: number | null
    quantity: number
    unitPrice: number
    amount: number
    note: string | null
    sortOrder: number
    category: string
  }>
  createdAt: string
  updatedAt: string
}

function fmtKRW(n: number) {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtDate(iso: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}.${mm}.${dd}`
}

function StatusBadge({ status }: { status: ProductionRunStatus }) {
  if (status === 'STOCKED_IN') {
    return (
      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
        {STATUS_LABEL[status]}
      </Badge>
    )
  }
  const variantMap: Record<ProductionRunStatus, 'outline' | 'secondary'> = {
    PLANNED: 'outline',
    ORDERED: 'secondary',
    STOCKED_IN: 'secondary',
  }
  return <Badge variant={variantMap[status]}>{STATUS_LABEL[status]}</Badge>
}

export default function ProductionRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { runId } = use(params)
  const [run, setRun] = useState<RunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFoundFlag, setNotFoundFlag] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/sh/production-runs/${runId}`)
        if (res.status === 404) {
          if (!cancelled) setNotFoundFlag(true)
          return
        }
        if (!res.ok) throw new Error('조회 실패')
        const data: { run: RunDetail } = await res.json()
        if (!cancelled) setRun(data.run)
      } catch {
        if (!cancelled) setRun(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [runId])

  if (notFoundFlag) notFound()
  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }
  if (!run) {
    return <p className="text-sm text-muted-foreground">생산 발주를 불러올 수 없습니다.</p>
  }

  const totalQuantity = run.items.reduce((s, it) => s + it.quantity, 0)

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="space-y-2">
        <Link
          href={SELLER_HUB_PRODUCTION_PATH}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          생산 관리 목록
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{run.runNo}</h1>
          <StatusBadge status={run.status} />
        </div>
        {run.memo && <p className="text-sm text-muted-foreground">{run.memo}</p>}
      </div>

      {/* 메타 정보 */}
      <div className="grid grid-cols-2 gap-4 rounded-md border p-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">브랜드</p>
          <p className="text-sm font-medium">{run.brand?.name ?? '-'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">발주일</p>
          <p className="text-sm font-medium">{fmtDate(run.orderedConfirmedAt)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">입고일</p>
          <p className="text-sm font-medium">{fmtDate(run.stockedInAt)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">납기일</p>
          <p className="text-sm font-medium">{fmtDate(run.dueAt)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">총 수량</p>
          <p className="text-sm font-medium tabular-nums">
            {totalQuantity.toLocaleString('ko-KR')}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">총 원가</p>
          <p className="text-sm font-medium tabular-nums">
            {run.totalCost != null ? fmtKRW(run.totalCost) : '-'}
          </p>
        </div>
      </div>

      {/* 옵션별 발주량 */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">옵션별 발주량</h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>상품</TableHead>
                <TableHead>옵션</TableHead>
                <TableHead className="w-[140px]">관리코드(SKU)</TableHead>
                <TableHead className="w-[100px] text-right">발주 수량</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    옵션이 없습니다
                  </TableCell>
                </TableRow>
              ) : (
                run.items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="text-sm">{it.productName}</TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        {it.optionName}
                        {it.optionDeleted && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            삭제됨
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {it.sku ?? '-'}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {it.quantity.toLocaleString('ko-KR')}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* 원가 내역 (BREAKDOWN 모드일 때) */}
      {run.costs.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">원가 내역</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>항목</TableHead>
                  <TableHead className="w-[90px] text-right">수량</TableHead>
                  <TableHead className="w-[110px] text-right">단가</TableHead>
                  <TableHead className="w-[120px] text-right">금액</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.costs.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm">
                      {c.itemName}
                      {c.description && (
                        <span className="ml-1 text-xs text-muted-foreground">{c.description}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {c.quantity.toLocaleString('ko-KR')}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {fmtKRW(c.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {fmtKRW(c.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
