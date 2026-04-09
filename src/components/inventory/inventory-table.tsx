'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowUpDown, Search } from 'lucide-react'

type InventoryRow = {
  id: string
  productName: string
  optionName: string | null
  optionId: string
  productId: string
  category: string | null
  availableStock: number | null
  inboundStock: number | null
  productGrade: string | null
  estimatedDepletion: string | null
  storageFee: number | null
  isItemWinner: boolean | null
  revenue30d: number | null
  salesQty30d: number | null
  visitors: number | null
  conversionRate: number | null
  itemWinnerRate: number | null
}

type SortField = 'productName' | 'availableStock' | 'revenue30d' | 'salesQty30d' | 'storageFee' | 'conversionRate'

export function InventoryTable() {
  const [records, setRecords] = useState<InventoryRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('availableStock')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [loading, setLoading] = useState(false)
  const limit = 50

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        sortBy,
        sortOrder,
        ...(search ? { search } : {}),
      })
      const res = await fetch(`/api/inventory?${params}`)
      if (!res.ok) {
        setRecords([])
        setTotal(0)
        return
      }
      const data = await res.json()
      setRecords(data.records ?? [])
      setTotal(data.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [page, search, sortBy, sortOrder])

  useEffect(() => { fetchData() }, [fetchData])

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
    setPage(1)
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setSearch(searchInput)
    setPage(1)
  }

  const totalPages = Math.ceil(total / limit)

  function stockBadge(stock: number | null) {
    if (stock == null) return <span className="text-muted-foreground">-</span>
    if (stock === 0) return <Badge variant="destructive">품절</Badge>
    if (stock <= 10) return <Badge variant="outline" className="border-yellow-400 text-yellow-600">{stock}</Badge>
    return <span>{stock.toLocaleString()}</span>
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="상품명 검색..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="outline" size="sm">검색</Button>
      </form>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">
                <Button variant="ghost" size="sm" onClick={() => toggleSort('productName')}>
                  상품명 <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => toggleSort('availableStock')}>
                  재고 <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>입고예정</TableHead>
              <TableHead>소진예상</TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => toggleSort('salesQty30d')}>
                  판매(30일) <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => toggleSort('revenue30d')}>
                  매출(30일) <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => toggleSort('storageFee')}>
                  보관료 <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>위너</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  로딩 중...
                </TableCell>
              </TableRow>
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  데이터가 없습니다
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="max-w-[300px]">
                      <p className="truncate text-sm font-medium">{r.productName}</p>
                      {r.optionName && (
                        <p className="truncate text-xs text-muted-foreground">{r.optionName}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{stockBadge(r.availableStock)}</TableCell>
                  <TableCell>
                    {r.inboundStock != null && r.inboundStock > 0 ? (
                      <span className="text-emerald-600">{r.inboundStock.toLocaleString()}</span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs">{r.estimatedDepletion ?? '-'}</span>
                  </TableCell>
                  <TableCell>{r.salesQty30d?.toLocaleString() ?? '-'}</TableCell>
                  <TableCell>
                    {r.revenue30d != null ? `${Number(r.revenue30d).toLocaleString()}원` : '-'}
                  </TableCell>
                  <TableCell>
                    {r.storageFee != null ? `${r.storageFee.toLocaleString()}원` : '-'}
                  </TableCell>
                  <TableCell>
                    {r.isItemWinner === true ? (
                      <Badge variant="secondary" className="text-[10px]">위너</Badge>
                    ) : r.isItemWinner === false ? (
                      <span className="text-xs text-muted-foreground">-</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            총 {total.toLocaleString()}개 상품
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              이전
            </Button>
            <span className="flex items-center text-sm text-muted-foreground">
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
    </div>
  )
}
