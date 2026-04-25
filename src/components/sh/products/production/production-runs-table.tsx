'use client'

import { useCallback, useEffect, useState } from 'react'
import { Edit2, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ProductionRunFormDialog } from './production-run-form-dialog'

// ─── 상수 ─────────────────────────────────────────────────────────────────────

type ProductionRunStatus = 'PLANNED' | 'ORDERED' | 'PRODUCING' | 'COMPLETED'

const STATUS_LABEL: Record<ProductionRunStatus, string> = {
  PLANNED: '계획중',
  ORDERED: '발주완료',
  PRODUCING: '생산중',
  COMPLETED: '생산완료',
}

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type ProductSummary = {
  id: string
  displayName: string
  brandName: string | null
}

type RunRow = {
  id: string
  runNo: string
  status: ProductionRunStatus
  brand: { id: string; name: string } | null
  orderedAt: string
  dueAt: string | null
  completedAt: string | null
  totalCost: number | null
  costMode: 'TOTAL' | 'BREAKDOWN'
  memo: string | null
  itemCount: number
  totalQuantity: number
  averageUnitCost: number | null
  products: ProductSummary[]
  items: Array<{
    optionId: string
    optionName: string
    productId: string
    productName: string
    quantity: number
  }>
  updatedAt: string
}

type BrandOption = { id: string; name: string }

// ─── 포맷 헬퍼 ────────────────────────────────────────────────────────────────

function fmtKRW(n: number) {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}.${mm}.${dd}`
}

// ─── 상태 배지 ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ProductionRunStatus }) {
  if (status === 'COMPLETED') {
    return (
      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
        {STATUS_LABEL[status]}
      </Badge>
    )
  }
  const variantMap: Record<ProductionRunStatus, 'outline' | 'secondary' | 'default'> = {
    PLANNED: 'outline',
    ORDERED: 'secondary',
    PRODUCING: 'default',
    COMPLETED: 'default', // fallback (위에서 처리됨)
  }
  return <Badge variant={variantMap[status]}>{STATUS_LABEL[status]}</Badge>
}

// ─── 상품 칩 ─────────────────────────────────────────────────────────────────

const MAX_CHIPS = 2

function ProductChips({ products }: { products: ProductSummary[] }) {
  const visible = products.slice(0, MAX_CHIPS)
  const rest = products.slice(MAX_CHIPS)

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((p) => (
        <Badge key={p.id} variant="secondary" className="max-w-[120px] truncate text-xs">
          {p.brandName ? `${p.brandName} · ` : ''}
          {p.displayName}
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
                {rest.map((p) => (
                  <li key={p.id}>
                    {p.brandName ? `${p.brandName} · ` : ''}
                    {p.displayName}
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export function ProductionRunsTable() {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const pageSize = 20

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [brandFilter, setBrandFilter] = useState<string>('ALL')
  const [brandOptions, setBrandOptions] = useState<BrandOption[]>([])
  const [loading, setLoading] = useState(false)

  // 다이얼로그 상태
  const [formOpen, setFormOpen] = useState(false)
  const [editRunId, setEditRunId] = useState<string | undefined>(undefined)

  // 삭제 confirm
  const [deleteTarget, setDeleteTarget] = useState<RunRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 브랜드 목록 로드 (최초 1회)
  useEffect(() => {
    fetch('/api/sh/brands')
      .then((r) => r.json())
      .then((d: { data?: BrandOption[] }) => setBrandOptions(d.data ?? []))
      .catch(() => {})
  }, [])

  // 검색어 debounce 300ms
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  // 필터 변경 시 페이지 초기화
  useEffect(() => {
    setPage(1)
  }, [statusFilter, brandFilter])

  // 목록 로드
  const loadRuns = useCallback(async () => {
    let cancelled = false
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      qs.set('page', String(page))
      qs.set('pageSize', String(pageSize))
      if (debouncedSearch.trim()) qs.set('search', debouncedSearch.trim())
      if (statusFilter !== 'ALL') qs.set('status', statusFilter)
      if (brandFilter !== 'ALL') qs.set('brandId', brandFilter)
      const res = await fetch(`/api/sh/production-runs?${qs.toString()}`)
      if (!res.ok) throw new Error('목록 조회 실패')
      const data: { data: RunRow[]; total: number; page: number; pageSize: number } =
        await res.json()
      if (!cancelled) {
        setRuns(data.data ?? [])
        setTotal(data.total ?? 0)
      }
    } catch (err) {
      if (!cancelled) toast.error(err instanceof Error ? err.message : '목록 조회 실패')
    } finally {
      if (!cancelled) setLoading(false)
    }
    return () => {
      cancelled = true
    }
  }, [page, debouncedSearch, statusFilter, brandFilter])

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  // 삭제
  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/sh/production-runs/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err: { message?: string } = await res.json().catch(() => ({}))
        throw new Error(err.message ?? '삭제 실패')
      }
      toast.success(`차수 ${deleteTarget.runNo} 삭제 완료`)
      setDeleteTarget(null)
      loadRuns()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    } finally {
      setDeleting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-3">
      {/* 상단 툴바 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="차수번호 · 메모 · 상품명"
              className="w-56 pl-9"
            />
          </div>
          {/* 상태 필터 */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="전체 상태" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">전체 상태</SelectItem>
              <SelectItem value="PLANNED">계획중</SelectItem>
              <SelectItem value="ORDERED">발주완료</SelectItem>
              <SelectItem value="PRODUCING">생산중</SelectItem>
              <SelectItem value="COMPLETED">생산완료</SelectItem>
            </SelectContent>
          </Select>
          {/* 브랜드 필터 */}
          {brandOptions.length > 0 && (
            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="전체 브랜드" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 브랜드</SelectItem>
                {brandOptions.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditRunId(undefined)
            setFormOpen(true)
          }}
        >
          <Plus className="mr-1 h-4 w-4" />
          차수 추가
        </Button>
      </div>

      {/* 테이블 */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px]">차수 번호</TableHead>
              <TableHead className="w-[80px]">상태</TableHead>
              <TableHead className="w-[90px]">발주일</TableHead>
              <TableHead className="w-[90px]">납기일</TableHead>
              <TableHead className="w-[90px]">브랜드</TableHead>
              <TableHead>포함 상품</TableHead>
              <TableHead className="w-[70px] text-right">총 수량</TableHead>
              <TableHead className="w-[110px] text-right">총 원가</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">등록된 차수가 없습니다</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      setEditRunId(undefined)
                      setFormOpen(true)
                    }}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    차수 추가
                  </Button>
                </TableCell>
              </TableRow>
            ) : (
              runs.map((run) => (
                <TableRow
                  key={run.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => {
                    setEditRunId(run.id)
                    setFormOpen(true)
                  }}
                >
                  <TableCell>
                    <p className="font-medium">{run.runNo}</p>
                    {run.memo && (
                      <p className="max-w-[100px] truncate text-xs text-muted-foreground">
                        {run.memo}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDate(run.orderedAt)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {run.dueAt ? fmtDate(run.dueAt) : '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {run.brand?.name ?? '-'}
                  </TableCell>
                  <TableCell>
                    <ProductChips products={run.products} />
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {run.totalQuantity.toLocaleString('ko-KR')}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {run.totalCost != null ? fmtKRW(run.totalCost) : '-'}
                  </TableCell>
                  <TableCell>
                    <div
                      className="flex items-center justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`${run.runNo} 편집`}
                        onClick={() => {
                          setEditRunId(run.id)
                          setFormOpen(true)
                        }}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        aria-label={`${run.runNo} 삭제`}
                        onClick={() => setDeleteTarget(run)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            총 {total.toLocaleString('ko-KR')}개 중 {(page - 1) * pageSize + 1}–
            {Math.min(page * pageSize, total)}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              이전
            </Button>
            <span className="px-2">
              {page} / {totalPages}
            </span>
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

      {/* 차수 추가/편집 다이얼로그 */}
      <ProductionRunFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        runId={editRunId}
        onSaved={() => {
          setFormOpen(false)
          loadRuns()
        }}
      />

      {/* 삭제 confirm 다이얼로그 */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>차수 삭제</DialogTitle>
            <DialogDescription>
              <strong>{deleteTarget?.runNo}</strong> 차수를 삭제하면 옵션 발주량·원가 정보가 모두
              제거됩니다. 계속하시겠습니까?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? '삭제 중...' : '삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
