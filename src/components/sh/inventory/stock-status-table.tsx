'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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

type LocationInfo = { id: string; name: string }
type StockByLocation = { locationId: string; locationName: string; quantity: number }
type StockRow = {
  productId: string
  productName: string
  groupName: string | null
  optionId: string
  optionName: string
  totalStock: number
  stockByLocation: StockByLocation[]
}
type GroupItem = { id: string; name: string }
type StockResponse = {
  data: StockRow[]
  locations: LocationInfo[]
  total: number
  page: number
  pageSize: number
}

const PAGE_SIZE = 20
const ALL = '__all__'

export function StockStatusTable() {
  const [groups, setGroups] = useState<GroupItem[]>([])
  const [groupFilter, setGroupFilter] = useState(ALL)
  const [locationFilter, setLocationFilter] = useState(ALL)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<StockResponse | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch groups once
  useEffect(() => {
    fetch('/api/sh/inventory/product-groups')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.groups) setGroups(json.groups)
      })
      .catch(() => {})
  }, [])

  // Debounce search
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

  // Reset page on filter change
  useEffect(() => {
    setPage(1)
  }, [groupFilter, locationFilter])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (groupFilter !== ALL) p.set('groupId', groupFilter)
      if (locationFilter !== ALL) p.set('locationId', locationFilter)
      if (debouncedSearch) p.set('search', debouncedSearch)
      const res = await fetch(`/api/sh/inventory/stock-status?${p}`)
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [page, groupFilter, locationFilter, debouncedSearch])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const totalPages = useMemo(() => Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE)), [data])

  // Determine which location columns to show
  const visibleLocations = useMemo(() => {
    if (!data) return []
    return data.locations
  }, [data])

  // All locations (for the filter dropdown)
  const [allLocations, setAllLocations] = useState<LocationInfo[]>([])
  useEffect(() => {
    fetch('/api/sh/inventory/locations?isActive=true')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.locations) setAllLocations(json.locations)
      })
      .catch(() => {})
  }, [])

  const fixedCols = 4 // group, product, option, total
  const totalCols = fixedCols + visibleLocations.length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="전체 그룹" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 그룹</SelectItem>
            <SelectItem value="none">미분류</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder="상품명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />

        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="전체 위치" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 위치</SelectItem>
            {allLocations.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>상품그룹</TableHead>
              <TableHead>상품명</TableHead>
              <TableHead>옵션명</TableHead>
              <TableHead className="text-right">전체 재고</TableHead>
              {visibleLocations.map((loc) => (
                <TableHead key={loc.id} className="text-right">
                  {loc.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !data ? (
              <TableRow>
                <TableCell colSpan={totalCols} className="py-8 text-center text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : !data || data.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={totalCols} className="py-8 text-center text-muted-foreground">
                  데이터가 없습니다
                </TableCell>
              </TableRow>
            ) : (
              data.data.map((row) => (
                <TableRow key={row.optionId}>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.groupName ?? '(기본)'}
                  </TableCell>
                  <TableCell className="font-medium">{row.productName}</TableCell>
                  <TableCell className="text-muted-foreground">{row.optionName}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${row.totalStock < 0 ? 'text-red-600' : ''}`}
                  >
                    {row.totalStock.toLocaleString()}
                  </TableCell>
                  {visibleLocations.map((loc) => {
                    const locStock = row.stockByLocation.find((s) => s.locationId === loc.id)
                    const qty = locStock?.quantity ?? 0
                    return (
                      <TableCell
                        key={loc.id}
                        className={`text-right tabular-nums ${qty < 0 ? 'text-red-600' : qty === 0 ? 'text-muted-foreground' : ''}`}
                      >
                        {qty === 0 ? '-' : qty.toLocaleString()}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            총 {data.total.toLocaleString()}개 · {page} / {totalPages} 페이지
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              이전
            </Button>
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
