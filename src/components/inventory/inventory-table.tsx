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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  returns30d: number | null
  visitors: number | null
  conversionRate: number | null
  itemWinnerRate: number | null
}

type SortField = 'productName' | 'availableStock' | 'revenue30d' | 'salesQty30d' | 'storageFee' | 'conversionRate' | 'returns30d' | 'returnRate' | 'storageFeeRate'

// 클라이언트 정렬이 필요한 계산 필드
const CLIENT_SORT_FIELDS: SortField[] = ['returnRate', 'storageFeeRate']

const COL_COUNT = 13

export function InventoryTable({ onExcludeChange }: { onExcludeChange?: () => void } = {}) {
  const [records, setRecords] = useState<InventoryRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('productName')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [loading, setLoading] = useState(false)
  const limit = 50

  // 필터
  const [isItemWinner, setIsItemWinner] = useState('all')
  const [productNameFilter, setProductNameFilter] = useState('__all__')
  const [productGrade, setProductGrade] = useState('all')
  const [excludedView, setExcludedView] = useState('active')
  const [productNames, setProductNames] = useState<string[]>([])
  const [excludedOptionIds, setExcludedOptionIds] = useState<string[]>([])

  // 계산 필드의 값 추출 (null이면 null 반환 → 정렬 시 마지막으로)
  function getCalcValue(r: InventoryRow, field: SortField): number | null {
    if (field === 'returnRate') {
      if (r.returns30d == null || r.salesQty30d == null || r.salesQty30d === 0) return null
      return r.returns30d / r.salesQty30d * 100
    }
    if (field === 'storageFeeRate') {
      if (r.storageFee == null || r.revenue30d == null || Number(r.revenue30d) === 0) return null
      return r.storageFee / Number(r.revenue30d) * 100
    }
    return null
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const isClientSort = CLIENT_SORT_FIELDS.includes(sortBy)
      const params = new URLSearchParams({
        page: isClientSort ? '1' : String(page),
        limit: isClientSort ? '200' : String(limit),
        // 계산 필드 정렬 시 서버에는 기본 정렬로 요청
        sortBy: isClientSort ? 'productName' : sortBy,
        sortOrder: isClientSort ? 'asc' : sortOrder,
        ...(search ? { search } : {}),
        ...(isItemWinner !== 'all' ? { isItemWinner } : {}),
        ...(productNameFilter !== '__all__' ? { productNameFilter } : {}),
        ...(productGrade !== 'all' ? { productGrade } : {}),
        excludedView,
      })
      const res = await fetch(`/api/inventory?${params}`)
      if (!res.ok) {
        setRecords([])
        setTotal(0)
        return
      }
      const data = await res.json()
      let rows: InventoryRow[] = data.records ?? []

      if (isClientSort && rows.length > 0) {
        // 클라이언트 정렬: null(="-")은 항상 마지막
        rows = [...rows].sort((a, b) => {
          const va = getCalcValue(a, sortBy)
          const vb = getCalcValue(b, sortBy)
          if (va == null && vb == null) return 0
          if (va == null) return 1  // null은 항상 뒤로
          if (vb == null) return -1
          return sortOrder === 'asc' ? va - vb : vb - va
        })
      }

      setRecords(rows)
      setTotal(data.total ?? 0)
      if (data.productNames) setProductNames(data.productNames)
      if (data.excludedOptionIds) setExcludedOptionIds(data.excludedOptionIds)
    } finally {
      setLoading(false)
    }
  }, [page, search, sortBy, sortOrder, isItemWinner, productNameFilter, productGrade, excludedView])

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

  async function toggleExclude(row: InventoryRow, isCurrentlyExcluded: boolean) {
    try {
      if (isCurrentlyExcluded) {
        await fetch('/api/inventory/excluded', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ optionId: row.optionId }),
        })
      } else {
        await fetch('/api/inventory/excluded', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: row.productId, optionId: row.optionId }),
        })
      }
      fetchData()
      onExcludeChange?.()
    } catch {
      // ignore
    }
  }

  const totalPages = Math.ceil(total / limit)

  function isOptionExcluded(optionId: string): boolean {
    return excludedOptionIds.includes(optionId)
  }

  function stockBadge(stock: number | null) {
    if (stock == null) return <span className="text-muted-foreground">-</span>
    if (stock === 0) return <Badge variant="destructive">품절</Badge>
    if (stock <= 10) return <Badge variant="outline" className="border-yellow-400 text-yellow-600">{stock}</Badge>
    return <span>{stock.toLocaleString()}</span>
  }

  function calcReturnRate(returns30d: number | null, salesQty30d: number | null): string {
    if (returns30d == null || salesQty30d == null || salesQty30d === 0) return '-'
    return `${(returns30d / salesQty30d * 100).toFixed(1)}%`
  }

  function calcStorageFeeRate(storageFee: number | null, revenue30d: number | null): string {
    if (storageFee == null || revenue30d == null || Number(revenue30d) === 0) return '-'
    return `${(storageFee / Number(revenue30d) * 100).toFixed(1)}%`
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

      {/* 필터: 상품명 → 등급 → 위너 → 관리 */}
      <div className="flex gap-2 flex-wrap">
        <Select value={productNameFilter} onValueChange={(v) => { setProductNameFilter(v); setPage(1) }}>
          <SelectTrigger className="w-[200px]" size="sm">
            <SelectValue placeholder="상품명 선택" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">상품명: 전체</SelectItem>
            {productNames.map(name => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={productGrade} onValueChange={(v) => { setProductGrade(v); setPage(1) }}>
          <SelectTrigger className="w-[130px]" size="sm">
            <SelectValue placeholder="상품등급" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">등급: 전체</SelectItem>
            <SelectItem value="NEW">NEW</SelectItem>
            <SelectItem value="반품">반품</SelectItem>
          </SelectContent>
        </Select>

        <Select value={isItemWinner} onValueChange={(v) => { setIsItemWinner(v); setPage(1) }}>
          <SelectTrigger className="w-[150px]" size="sm">
            <SelectValue placeholder="위너 필터" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">위너: 전체</SelectItem>
            <SelectItem value="true">위너 상품</SelectItem>
            <SelectItem value="false">위너 아닌 상품</SelectItem>
          </SelectContent>
        </Select>

        <Select value={excludedView} onValueChange={(v) => { setExcludedView(v); setPage(1) }}>
          <SelectTrigger className="w-[150px]" size="sm">
            <SelectValue placeholder="관리 상태" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">관리 상품</SelectItem>
            <SelectItem value="excluded">제외 상품</SelectItem>
            <SelectItem value="all">전체</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">
                <Button variant="ghost" size="sm" onClick={() => toggleSort('productName')}>
                  상품명 <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>관리 상태</TableHead>
              <TableHead>등급</TableHead>
              <TableHead>위너</TableHead>
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
                <Button variant="ghost" size="sm" onClick={() => toggleSort('returnRate')}>
                  반품율(%) <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => toggleSort('storageFee')}>
                  보관료 <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => toggleSort('storageFeeRate')}>
                  보관료율(%) <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>상품관리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={COL_COUNT} className="h-24 text-center text-muted-foreground">
                  로딩 중...
                </TableCell>
              </TableRow>
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COL_COUNT} className="h-24 text-center text-muted-foreground">
                  데이터가 없습니다
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => {
                const excluded = isOptionExcluded(r.optionId)
                return (
                  <TableRow key={r.id}>
                    {/* 상품명 */}
                    <TableCell>
                      <div className="max-w-[300px]">
                        <p className="truncate text-sm font-medium">{r.productName}</p>
                        {r.optionName && (
                          <p className="truncate text-xs text-muted-foreground">{r.optionName}</p>
                        )}
                      </div>
                    </TableCell>
                    {/* 관리 상태 */}
                    <TableCell>
                      {excluded ? (
                        <Badge variant="outline" className="text-[10px] border-gray-300 text-gray-500">제외</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-600">관리</Badge>
                      )}
                    </TableCell>
                    {/* 등급 */}
                    <TableCell>
                      {r.productGrade ? (
                        <Badge variant="outline" className="text-[10px]">{r.productGrade}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    {/* 위너 */}
                    <TableCell>
                      {r.isItemWinner === true ? (
                        <Badge variant="secondary" className="text-[10px]">위너</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    {/* 재고 */}
                    <TableCell>{stockBadge(r.availableStock)}</TableCell>
                    {/* 입고예정 */}
                    <TableCell>
                      {r.inboundStock != null && r.inboundStock > 0 ? (
                        <span className="text-emerald-600">{r.inboundStock.toLocaleString()}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    {/* 소진예상 */}
                    <TableCell>
                      <span className="text-xs">{r.estimatedDepletion ?? '-'}</span>
                    </TableCell>
                    {/* 판매(30일) */}
                    <TableCell>{r.salesQty30d?.toLocaleString() ?? '-'}</TableCell>
                    {/* 매출(30일) */}
                    <TableCell>
                      {r.revenue30d != null ? `${Number(r.revenue30d).toLocaleString()}원` : '-'}
                    </TableCell>
                    {/* 반품율(%) */}
                    <TableCell>
                      <span className="text-xs">{calcReturnRate(r.returns30d, r.salesQty30d)}</span>
                    </TableCell>
                    {/* 보관료 */}
                    <TableCell>
                      {r.storageFee != null ? `${r.storageFee.toLocaleString()}원` : '-'}
                    </TableCell>
                    {/* 보관료율(%) */}
                    <TableCell>
                      <span className="text-xs">{calcStorageFeeRate(r.storageFee, r.revenue30d)}</span>
                    </TableCell>
                    {/* 상품관리 */}
                    <TableCell>
                      <Button
                        variant={excluded ? 'outline' : 'destructive'}
                        size="sm"
                        className="text-xs h-7 px-3"
                        onClick={() => toggleExclude(r, excluded)}
                      >
                        {excluded ? '복원하기' : '제외하기'}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
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
