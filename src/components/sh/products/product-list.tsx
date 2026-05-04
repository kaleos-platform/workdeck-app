'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, FolderCog, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ShCategoryManager } from '@/components/sh/products/category-manager'
import { productDisplayName } from '@/lib/sh/product-display'

type ProductRow = {
  id: string
  name: string // 공식 상품명
  internalName?: string | null // 관리 상품명
  nameEn: string | null
  code: string | null
  status: 'ACTIVE' | 'INACTIVE'
  groupId: string | null
  group?: { id: string; name: string } | null
  groupName?: string | null
  brandId: string | null
  brand?: { id: string; name: string } | null
  brandName?: string | null
  // API GET은 include: { options: true } 로 배열을 반환
  options?: { id: string; totalStock?: number }[]
  optionsCount?: number
}

type Group = { id: string; name: string }
type Brand = { id: string; name: string }
type StatusFilter = 'ACTIVE' | 'INACTIVE' | 'all'

const PAGE_SIZE = 20

export function ShProductList() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<ProductRow[]>([])
  const [total, setTotal] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [groups, setGroups] = useState<Group[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [groupFilter, setGroupFilter] = useState('all')
  const [brandFilter, setBrandFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ACTIVE')
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [statusTarget, setStatusTarget] = useState<{
    product: ProductRow
    nextStatus: 'ACTIVE' | 'INACTIVE'
  } | null>(null)
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // 카테고리/브랜드 목록 로드
  const loadFilters = useCallback(async () => {
    const [gRes, bRes] = await Promise.all([fetch('/api/sh/categories'), fetch('/api/sh/brands')])
    const [gData, bData] = await Promise.all([
      gRes.ok ? gRes.json() : null,
      bRes.ok ? bRes.json() : null,
    ])
    setGroups(gData?.categories ?? [])
    setBrands(bData?.brands ?? [])
  }, [])

  useEffect(() => {
    void loadFilters()
  }, [loadFilters])

  // 검색어 debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (groupFilter !== 'all') params.set('groupId', groupFilter)
      if (brandFilter !== 'all') params.set('brandId', brandFilter)
      params.set('status', statusFilter)
      const res = await fetch(`/api/sh/products?${params.toString()}`)
      if (!res.ok) {
        setRows([])
        setTotal(0)
        return
      }
      const json = await res.json()
      setRows(json.data ?? json.products ?? [])
      setTotal(json.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch, groupFilter, brandFilter, statusFilter])

  useEffect(() => {
    void fetchProducts()
  }, [fetchProducts])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  async function handleStatusChange() {
    if (!statusTarget) return
    const { product, nextStatus } = statusTarget
    setStatusUpdatingId(product.id)
    try {
      const res = await fetch(`/api/sh/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '상태 변경 실패')
      toast.success(
        nextStatus === 'ACTIVE' ? '상품을 사용 재개했습니다' : '상품을 미사용 처리했습니다'
      )
      setStatusTarget(null)
      await fetchProducts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '상태 변경 실패')
    } finally {
      setStatusUpdatingId(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeletingId(deleteTarget.id)
    try {
      const res = await fetch(`/api/sh/products/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '삭제 실패')
      }
      toast.success('상품이 삭제되었습니다')
      setDeleteTarget(null)
      await fetchProducts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* 카테고리 관리 Dialog */}
      <ShCategoryManager
        open={categoryManagerOpen}
        onOpenChange={setCategoryManagerOpen}
        onChanged={() => void loadFilters()}
      />

      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="관리 상품명·영문명·제품코드·옵션 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={groupFilter}
          onValueChange={(v) => {
            setGroupFilter(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="전체 카테고리" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 카테고리</SelectItem>
            <SelectItem value="none">미분류</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={brandFilter}
          onValueChange={(v) => {
            setBrandFilter(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="전체 브랜드" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 브랜드</SelectItem>
            <SelectItem value="none">브랜드 없음</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as StatusFilter)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="상태" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ACTIVE">사용중</SelectItem>
            <SelectItem value="INACTIVE">미사용</SelectItem>
            <SelectItem value="all">전체</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setCategoryManagerOpen(true)}>
          <FolderCog className="mr-1.5 h-4 w-4" />
          카테고리 관리
        </Button>
        <div className="ml-auto">
          <Button size="sm" asChild>
            <Link href="/d/seller-ops/products/new">
              <Plus className="mr-1 h-4 w-4" />
              상품 생성
            </Link>
          </Button>
        </div>
      </div>

      {/* 상품 테이블 */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>카테고리</TableHead>
              <TableHead>상품명</TableHead>
              <TableHead>브랜드</TableHead>
              <TableHead>제품코드</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">옵션수</TableHead>
              <TableHead className="text-right">재고</TableHead>
              <TableHead className="w-36 text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  등록된 상품이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const groupLabel = row.group?.name ?? row.groupName ?? '(기본)'
                const brandLabel = row.brand?.name ?? row.brandName ?? null
                const optionCount = row.optionsCount ?? row.options?.length ?? 0
                const totalStock = (row.options ?? []).reduce(
                  (sum, o) => sum + (o.totalStock ?? 0),
                  0
                )
                const displayName = productDisplayName(row)
                const goDetail = () => router.push(`/d/seller-ops/products/${row.id}`)
                const isInactive = row.status === 'INACTIVE'
                const nextStatus = isInactive ? 'ACTIVE' : 'INACTIVE'
                return (
                  <TableRow
                    key={row.id}
                    onClick={goDetail}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        goDetail()
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`${displayName} 상세`}
                    className={`cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none ${
                      isInactive ? 'bg-muted/20 text-muted-foreground' : ''
                    }`}
                  >
                    <TableCell className="text-sm text-muted-foreground">{groupLabel}</TableCell>
                    <TableCell>
                      <div className="font-medium">{displayName}</div>
                    </TableCell>
                    <TableCell>
                      {brandLabel ? (
                        <Badge variant="secondary">{brandLabel}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.code ?? '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isInactive ? 'outline' : 'secondary'}>
                        {isInactive ? '미사용' : '사용중'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{optionCount}</TableCell>
                    <TableCell
                      className={`text-right ${totalStock === 0 ? 'text-destructive' : ''}`}
                    >
                      {totalStock.toLocaleString('ko-KR')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={statusUpdatingId === row.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          setStatusTarget({ product: row, nextStatus })
                        }}
                        aria-label={
                          isInactive ? `${displayName} 사용 재개` : `${displayName} 미사용 처리`
                        }
                      >
                        {statusUpdatingId === row.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : isInactive ? (
                          <RotateCcw className="h-4 w-4" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                        <span className="sr-only">{isInactive ? '사용 재개' : '미사용 처리'}</span>
                      </Button>
                      {isInactive && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={deletingId === row.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteTarget(row)
                          }}
                          aria-label={`${displayName} 삭제`}
                        >
                          {deletingId === row.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-destructive" />
                          )}
                          <span className="sr-only">삭제</span>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* 페이지네이션 */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          총 {total.toLocaleString('ko-KR')}개 · {page} / {totalPages} 페이지
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            이전
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            다음
          </Button>
        </div>
      </div>

      <Dialog open={statusTarget !== null} onOpenChange={(open) => !open && setStatusTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {statusTarget?.nextStatus === 'ACTIVE' ? '상품 사용 재개' : '상품 미사용 처리'}
            </DialogTitle>
            <DialogDescription>
              {statusTarget ? (
                <>
                  <span className="font-medium text-foreground">
                    {productDisplayName(statusTarget.product)}
                  </span>
                  {statusTarget.nextStatus === 'ACTIVE'
                    ? ' 상품을 다시 신규 작업에서 선택할 수 있게 합니다.'
                    : ' 상품을 신규 판매채널 상품 생성과 입고 선택에서 제외합니다. 기존 재고, 입출고 이력, 판매채널 연결 데이터는 삭제되지 않습니다.'}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStatusTarget(null)}
              disabled={statusUpdatingId !== null}
            >
              취소
            </Button>
            <Button
              type="button"
              variant={statusTarget?.nextStatus === 'ACTIVE' ? 'default' : 'destructive'}
              onClick={handleStatusChange}
              disabled={statusUpdatingId !== null}
            >
              {statusUpdatingId !== null && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {statusTarget?.nextStatus === 'ACTIVE' ? '사용 재개' : '미사용 처리'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>상품 영구 삭제</DialogTitle>
            <DialogDescription>
              {deleteTarget ? (
                <>
                  <span className="font-medium text-foreground">
                    {productDisplayName(deleteTarget)}
                  </span>
                  {' 상품을 영구 삭제합니다. 이 작업은 미사용 상태 상품에서만 가능하며, 연결된 '}
                  재고/입출고/판매채널 데이터가 있으면 삭제되지 않습니다.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deletingId !== null}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deletingId !== null}
            >
              {deletingId !== null && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              영구 삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
