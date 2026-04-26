'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FolderCog, Plus } from 'lucide-react'
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
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)

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
  }, [page, debouncedSearch, groupFilter, brandFilter])

  useEffect(() => {
    void fetchProducts()
  }, [fetchProducts])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

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
              <TableHead className="text-right">옵션수</TableHead>
              <TableHead className="text-right">재고</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
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
                    className="cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
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
                    <TableCell className="text-right">{optionCount}</TableCell>
                    <TableCell
                      className={`text-right ${totalStock === 0 ? 'text-destructive' : ''}`}
                    >
                      {totalStock.toLocaleString('ko-KR')}
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
    </div>
  )
}
