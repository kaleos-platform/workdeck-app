'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Edit2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ProductionRunFormDialog } from './production-run-form-dialog'
import {
  ProductionRunTransitionDialog,
  type TransitionTarget,
} from './production-run-transition-dialog'
import {
  PRODUCTION_STATUS_LABEL,
  PRODUCTION_STATUS_ORDER,
  type ProductionRunStatus,
  type ProductionRunsSortBy,
  type ProductionRunsSortOrder,
  type ProductionStatusTab,
} from '@/lib/sh/production-runs-query'

// ─── 상수 ─────────────────────────────────────────────────────────────────────

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
  dueAt: string | null
  completedAt: string | null
  orderedConfirmedAt: string | null
  stockedInAt: string | null
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
    stockedInQty: number | null
  }>
  updatedAt: string
}

type BrandOption = { id: string; name: string }

type SortableHeadProps = {
  field: ProductionRunsSortBy
  label: string
  className?: string
  align?: 'left' | 'right'
  sortBy: ProductionRunsSortBy
  sortOrder: ProductionRunsSortOrder
  onSort: (field: ProductionRunsSortBy) => void
}

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
  if (status === 'STOCKED_IN') {
    return (
      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
        {PRODUCTION_STATUS_LABEL[status]}
      </Badge>
    )
  }
  const variantMap: Record<ProductionRunStatus, 'outline' | 'secondary' | 'default'> = {
    PLANNED: 'outline',
    ORDERED: 'secondary',
    STOCKED_IN: 'default', // fallback (위에서 처리됨)
  }
  return <Badge variant={variantMap[status]}>{PRODUCTION_STATUS_LABEL[status]}</Badge>
}

// ─── 상태 전환 메뉴 ──────────────────────────────────────────────────────────

const TRANSITION_TARGETS: ProductionRunStatus[] = ['PLANNED', 'ORDERED', 'STOCKED_IN']

function StatusTransitionMenu({
  run,
  onSelect,
}: {
  run: RunRow
  onSelect: (target: ProductionRunStatus) => void
}) {
  const others = TRANSITION_TARGETS.filter((t) => t !== run.status)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${run.runNo} 상태 변경`}
        >
          <StatusBadge status={run.status} />
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-32">
        {others.map((t) => (
          <DropdownMenuItem key={t} onSelect={() => onSelect(t)}>
            {PRODUCTION_STATUS_LABEL[t]}로 변경
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── 상품 칩 ─────────────────────────────────────────────────────────────────

const MAX_CHIPS = 2

function ProductChips({ products }: { products: ProductSummary[] }) {
  const visible = products.slice(0, MAX_CHIPS)
  const rest = products.slice(MAX_CHIPS)

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((p) => (
        <Badge key={p.id} variant="secondary" className="max-w-[160px] truncate text-xs">
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
                  <li key={p.id}>{p.displayName}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
}

function SortableHead({
  field,
  label,
  className,
  align = 'left',
  sortBy,
  sortOrder,
  onSort,
}: SortableHeadProps) {
  const active = sortBy === field
  const Icon = active ? (sortOrder === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown

  return (
    <TableHead
      className={className}
      aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={`inline-flex w-full items-center gap-1 text-xs font-medium hover:text-foreground ${
          align === 'right' ? 'justify-end' : 'justify-start'
        }`}
        onClick={() => onSort(field)}
      >
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? 'opacity-100' : 'opacity-40'}`} />
      </button>
    </TableHead>
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
  const [statusFilter, setStatusFilter] = useState<ProductionRunStatus>('PLANNED')
  const [brandFilter, setBrandFilter] = useState<string>('ALL')
  const [brandOptions, setBrandOptions] = useState<BrandOption[]>([])
  const [statusTabs, setStatusTabs] = useState<ProductionStatusTab[]>(
    PRODUCTION_STATUS_ORDER.map((status) => ({
      value: status,
      label: PRODUCTION_STATUS_LABEL[status],
      count: 0,
    }))
  )
  const [sortBy, setSortBy] = useState<ProductionRunsSortBy>('orderedConfirmedAt')
  const [sortOrder, setSortOrder] = useState<ProductionRunsSortOrder>('desc')
  const [loading, setLoading] = useState(false)

  // 다이얼로그 상태
  const [formOpen, setFormOpen] = useState(false)
  const [editRunId, setEditRunId] = useState<string | undefined>(undefined)

  // 삭제 confirm
  const [deleteTarget, setDeleteTarget] = useState<RunRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 상태 전환 다이얼로그
  const [transitionRun, setTransitionRun] = useState<RunRow | null>(null)
  const [transitionTarget, setTransitionTarget] = useState<TransitionTarget | null>(null)
  const [transitionOpen, setTransitionOpen] = useState(false)

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
      qs.set('status', statusFilter)
      if (brandFilter !== 'ALL') qs.set('brandId', brandFilter)
      qs.set('sortBy', sortBy)
      qs.set('sortOrder', sortOrder)
      const res = await fetch(`/api/sh/production-runs?${qs.toString()}`)
      if (!res.ok) throw new Error('목록 조회 실패')
      const data: {
        data: RunRow[]
        total: number
        page: number
        pageSize: number
        statusTabs?: ProductionStatusTab[]
      } = await res.json()
      if (!cancelled) {
        setRuns(data.data ?? [])
        setTotal(data.total ?? 0)
        if (data.statusTabs) setStatusTabs(data.statusTabs)
      }
    } catch (err) {
      if (!cancelled) toast.error(err instanceof Error ? err.message : '목록 조회 실패')
    } finally {
      if (!cancelled) setLoading(false)
    }
    return () => {
      cancelled = true
    }
  }, [page, debouncedSearch, statusFilter, brandFilter, sortBy, sortOrder])

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

  function handleSort(field: ProductionRunsSortBy) {
    if (sortBy === field) {
      setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortOrder(
        field === 'runNo' ||
          field === 'status' ||
          field === 'brandName' ||
          field === 'productName' ||
          field === 'memo'
          ? 'asc'
          : 'desc'
      )
    }
    setPage(1)
  }

  return (
    <div className="space-y-3">
      <Tabs
        value={statusFilter}
        onValueChange={(value) => {
          setStatusFilter(value as ProductionRunStatus)
          setPage(1)
        }}
      >
        <TabsList>
          {statusTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
              {tab.label}
              <span className="text-xs text-muted-foreground">
                {tab.count.toLocaleString('ko-KR')}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

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
              <SortableHead
                field="runNo"
                label="차수 번호"
                className="w-[110px]"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={handleSort}
              />
              <SortableHead
                field="status"
                label="상태"
                className="w-[80px]"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={handleSort}
              />
              <SortableHead
                field="orderedConfirmedAt"
                label="발주일"
                className="w-[90px]"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={handleSort}
              />
              <SortableHead
                field="stockedInAt"
                label="입고일"
                className="w-[90px]"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={handleSort}
              />
              <SortableHead
                field="dueAt"
                label="납기일"
                className="w-[90px]"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={handleSort}
              />
              <SortableHead
                field="brandName"
                label="브랜드"
                className="w-[90px]"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={handleSort}
              />
              <SortableHead
                field="productName"
                label="포함 상품"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={handleSort}
              />
              <SortableHead
                field="memo"
                label="메모"
                className="w-[160px]"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={handleSort}
              />
              <SortableHead
                field="totalQuantity"
                label="총 수량"
                className="w-[70px] text-right"
                align="right"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={handleSort}
              />
              <SortableHead
                field="totalCost"
                label="총 원가"
                className="w-[110px] text-right"
                align="right"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={handleSort}
              />
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="py-12 text-center text-sm text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="py-12 text-center">
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
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <StatusTransitionMenu
                      run={run}
                      onSelect={(target) => {
                        setTransitionRun(run)
                        setTransitionTarget(target)
                        setTransitionOpen(true)
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {run.orderedConfirmedAt ? fmtDate(run.orderedConfirmedAt) : '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {run.stockedInAt ? fmtDate(run.stockedInAt) : '-'}
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
                  <TableCell className="max-w-[160px] truncate text-sm text-muted-foreground">
                    {run.memo ?? '-'}
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

      {/* 상태 전환 다이얼로그 */}
      <ProductionRunTransitionDialog
        open={transitionOpen}
        onOpenChange={(v) => {
          setTransitionOpen(v)
          if (!v) {
            setTransitionRun(null)
            setTransitionTarget(null)
          }
        }}
        target={transitionTarget}
        run={
          transitionRun
            ? {
                id: transitionRun.id,
                runNo: transitionRun.runNo,
                totalQuantity: transitionRun.totalQuantity,
                itemCount: transitionRun.itemCount,
                items: transitionRun.items.map((it) => ({
                  optionId: it.optionId,
                  optionName: it.optionName,
                  quantity: it.quantity,
                })),
              }
            : null
        }
        onSaved={loadRuns}
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
