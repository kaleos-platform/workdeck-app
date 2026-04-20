'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ProductDetail } from '@/components/sh/inventory/product-detail'
import { ProductGroupManager } from '@/components/sh/inventory/product-group-manager'

type ProductRow = {
  id: string
  name: string
  code: string | null
  groupId: string | null
  groupName: string | null
  optionsCount: number
  totalStock: number
}

type ListResponse = {
  data: ProductRow[]
  total: number
  page: number
  pageSize: number
}

const PAGE_SIZE = 20

export function ProductList() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<ProductRow[]>([])
  const [total, setTotal] = useState(0)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([])
  const [groupFilter, setGroupFilter] = useState<string>('all')

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkGroupId, setBulkGroupId] = useState('')

  // Group manager dialog state
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)

  const fetchGroups = useCallback(() => {
    fetch('/api/inv/product-groups')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.groups) setGroups(json.groups)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchGroups()
  }, [fetchGroups])

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
      const res = await fetch(`/api/inv/products?${params.toString()}`)
      if (!res.ok) {
        setRows([])
        setTotal(0)
        return
      }
      const json: ListResponse = await res.json()
      setRows(json.data)
      setTotal(json.total)
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch, groupFilter])

  useEffect(() => {
    void fetchProducts()
  }, [fetchProducts])

  // Clear selection when page or filter changes
  useEffect(() => {
    setSelectedIds(new Set())
    setBulkGroupId('')
  }, [page, debouncedSearch, groupFilter])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id))

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(rows.map((r) => r.id)))
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleBulkGroupChange = async () => {
    if (!bulkGroupId) return
    const newGroupId = bulkGroupId === 'none' ? null : bulkGroupId
    await Promise.all(
      Array.from(selectedIds).map((id) =>
        fetch(`/api/inv/products/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: newGroupId }),
        })
      )
    )
    setSelectedIds(new Set())
    setBulkGroupId('')
    void fetchProducts()
  }

  const handleGroupsChanged = () => {
    fetchGroups()
    void fetchProducts()
  }

  const handleDetailClose = (changed: boolean) => {
    setSelectedProductId(null)
    if (changed) void fetchProducts()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="상품명 또는 제품코드 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select
          value={groupFilter}
          onValueChange={(v) => {
            setGroupFilter(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-40">
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
        <Button variant="outline" size="sm" onClick={() => setGroupManagerOpen(true)}>
          <Settings2 className="mr-1 h-4 w-4" />
          그룹 관리
        </Button>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2">
          <span className="text-sm font-medium">{selectedIds.size}개 선택</span>
          <Select value={bulkGroupId} onValueChange={setBulkGroupId}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue placeholder="그룹 변경" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">(기본)</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={handleBulkGroupChange} disabled={!bulkGroupId}>
            적용
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            선택 해제
          </Button>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="전체 선택"
                />
              </TableHead>
              <TableHead>그룹</TableHead>
              <TableHead>상품명</TableHead>
              <TableHead>제품코드</TableHead>
              <TableHead className="text-right">옵션수</TableHead>
              <TableHead className="w-24 text-right">동작</TableHead>
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
                  등록된 상품이 없습니다. 입고 기록으로 자동 생성됩니다.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedProductId(row.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(row.id)}
                      onCheckedChange={() => toggleSelect(row.id)}
                      aria-label={`${row.name} 선택`}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.groupName ?? '(기본)'}
                  </TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">{row.code ?? '-'}</TableCell>
                  <TableCell className="text-right">{row.optionsCount}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedProductId(row.id)
                      }}
                    >
                      수정
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          총 {total.toLocaleString()}개 · {page} / {totalPages} 페이지
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

      <Dialog
        open={!!selectedProductId}
        onOpenChange={(open) => {
          if (!open) handleDetailClose(false)
        }}
      >
        <DialogContent className="max-w-3xl">
          {selectedProductId && (
            <ProductDetail productId={selectedProductId} onClose={() => handleDetailClose(true)} />
          )}
        </DialogContent>
      </Dialog>

      <ProductGroupManager
        open={groupManagerOpen}
        onOpenChange={setGroupManagerOpen}
        onChanged={handleGroupsChanged}
      />
    </div>
  )
}
