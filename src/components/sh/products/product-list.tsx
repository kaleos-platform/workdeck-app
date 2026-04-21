'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
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
import { ShProductCreateDialog } from '@/components/sh/products/product-create-dialog'

type ProductRow = {
  id: string
  name: string
  nameEn: string | null
  code: string | null
  groupId: string | null
  groupName: string | null
  brandId: string | null
  brandName: string | null
  optionsCount: number
  totalStock: number
}

type Group = { id: string; name: string }
type Brand = { id: string; name: string }

const PAGE_SIZE = 20

export function ShProductList() {
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

  // 그룹/브랜드 목록 로드
  useEffect(() => {
    Promise.all([
      fetch('/api/sh/inventory/product-groups').then((res) => (res.ok ? res.json() : null)),
      fetch('/api/sh/brands').then((res) => (res.ok ? res.json() : null)),
    ]).then(([gData, bData]) => {
      setGroups(gData?.groups ?? [])
      setBrands(bData?.brands ?? [])
    })
  }, [])

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
      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="상품명 또는 제품코드 검색"
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
          <SelectTrigger className="w-36">
            <SelectValue placeholder="전체 그룹" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 그룹</SelectItem>
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
        <div className="ml-auto">
          <ShProductCreateDialog onCreated={fetchProducts} />
        </div>
      </div>

      {/* 상품 테이블 */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>그룹</TableHead>
              <TableHead>상품명</TableHead>
              <TableHead>브랜드</TableHead>
              <TableHead>제품코드</TableHead>
              <TableHead className="text-right">옵션수</TableHead>
              <TableHead className="w-20" />
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
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.groupName ?? '(기본)'}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{row.name}</div>
                    {row.nameEn && (
                      <div className="text-xs text-muted-foreground">{row.nameEn}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.brandName ? (
                      <Badge variant="secondary">{row.brandName}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.code ?? '-'}</TableCell>
                  <TableCell className="text-right">{row.optionsCount}</TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/d/seller-hub/products/${row.id}`}>상세</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
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
