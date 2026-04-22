'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
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

type ReorderRow = {
  productId: string
  productName: string
  productCode: string | null
  brandId: string | null
  brandName: string | null
  optionCount: number
  currentStock: number
  totalOutbound: number
  windowDays: number
  dailyAvgOutbound: number
  leadTimeDays: number
  safetyStockQty: number
  neededStock: number
  reorderQty: number
  estimatedDepletionDays: number | null
  isUrgent: boolean
  hasConfig: boolean
}

type Brand = { id: string; name: string }
type Filter = 'all' | 'needed' | 'urgent'

const ALL = 'all'
const NO_BRAND = 'none'

function statusBadge(row: ReorderRow) {
  if (row.totalOutbound === 0) {
    return (
      <Badge variant="outline" className="border-gray-300 bg-gray-50 text-gray-600">
        데이터 부족
      </Badge>
    )
  }
  if (row.reorderQty > 0) {
    return (
      <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">
        발주 필요
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
      정상
    </Badge>
  )
}

function formatDepletion(d: number | null) {
  if (d === null) return '-'
  return `${d.toFixed(1)}일`
}

export function ReorderTable() {
  const [rows, setRows] = useState<ReorderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [windowDays, setWindowDays] = useState(90)
  const [editing, setEditing] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  // 필터: 브랜드·상품 검색
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandFilter, setBrandFilter] = useState<string>(ALL)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  // 브랜드 목록 로드 (셀러허브 공용 /api/sh/brands)
  useEffect(() => {
    fetch('/api/sh/brands')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBrands(d?.brands ?? []))
      .catch(() => setBrands([]))
  }, [])

  const fetchData = useCallback(async (f: Filter, brandId: string, q: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (f === 'needed') params.set('reorderNeededOnly', 'true')
      if (f === 'urgent') params.set('urgentOnly', 'true')
      if (brandId !== ALL) params.set('brandId', brandId)
      if (q.trim()) params.set('search', q.trim())
      const qs = params.toString()
      const res = await fetch(`/api/sh/inventory/reorder${qs ? `?${qs}` : ''}`)
      if (!res.ok) throw new Error('불러오기 실패')
      const json = (await res.json()) as { data: ReorderRow[]; windowDays: number }
      setRows(json.data)
      setWindowDays(json.windowDays)
      setEditing({})
    } catch (err) {
      console.error(err)
      toast.error('발주 예측 데이터를 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(filter, brandFilter, debouncedSearch)
  }, [filter, brandFilter, debouncedSearch, fetchData])

  const handleEditChange = (productId: string, value: string) => {
    const n = Number(value)
    setEditing((prev) => ({ ...prev, [productId]: Number.isFinite(n) ? n : 0 }))
  }

  const handleSaveLeadTime = async (row: ReorderRow) => {
    const next = editing[row.productId]
    if (next === undefined || next === row.leadTimeDays) return
    if (next < 0) {
      toast.error('리드타임은 0 이상이어야 합니다')
      return
    }
    setSaving((s) => ({ ...s, [row.productId]: true }))
    try {
      const res = await fetch(`/api/sh/inventory/reorder/config/${row.productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadTimeDays: next }),
      })
      if (!res.ok) throw new Error('저장 실패')
      toast.success('리드타임을 저장했습니다')
      await fetchData(filter, brandFilter, debouncedSearch)
    } catch (err) {
      console.error(err)
      toast.error('리드타임 저장에 실패했습니다')
    } finally {
      setSaving((s) => ({ ...s, [row.productId]: false }))
    }
  }

  const counts = useMemo(() => {
    const needed = rows.filter((r) => r.reorderQty > 0).length
    const urgent = rows.filter((r) => r.isUrgent).length
    return { total: rows.length, needed, urgent }
  }, [rows])

  return (
    <div className="space-y-4">
      {/* 상태 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
        >
          전체
        </Button>
        <Button
          size="sm"
          variant={filter === 'needed' ? 'default' : 'outline'}
          onClick={() => setFilter('needed')}
        >
          발주 필요만
        </Button>
        <Button
          size="sm"
          variant={filter === 'urgent' ? 'default' : 'outline'}
          onClick={() => setFilter('urgent')}
        >
          긴급 (7일 이내)
        </Button>
        <div className="ml-auto text-xs text-muted-foreground">
          분석 기간 기본 {windowDays}일 · 총 {counts.total}건 · 발주 필요 {counts.needed}건 · 긴급{' '}
          {counts.urgent}건
        </div>
      </div>

      {/* 브랜드/상품 검색 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="상품명 또는 제품코드 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="전체 브랜드" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 브랜드</SelectItem>
            <SelectItem value={NO_BRAND}>브랜드 없음</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>상품</TableHead>
              <TableHead>브랜드</TableHead>
              <TableHead>제품코드</TableHead>
              <TableHead className="text-right">옵션수</TableHead>
              <TableHead className="text-right">현재재고</TableHead>
              <TableHead className="text-right">{windowDays}일 출고</TableHead>
              <TableHead className="text-right">일평균</TableHead>
              <TableHead className="w-[180px]" title="이 상품의 모든 옵션에 공통 적용됩니다">
                리드타임(일)
              </TableHead>
              <TableHead className="text-right">발주 필요량</TableHead>
              <TableHead className="text-right">예상 소진일</TableHead>
              <TableHead>상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">
                  분석할 상품이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const editValue = editing[row.productId] ?? row.leadTimeDays
                const dirty = editValue !== row.leadTimeDays
                const isSaving = saving[row.productId] === true
                return (
                  <TableRow key={row.productId} className={row.isUrgent ? 'bg-red-50/40' : ''}>
                    <TableCell className="font-medium">{row.productName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.brandName ?? '-'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.productCode ?? '-'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.optionCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.currentStock}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.totalOutbound}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.dailyAvgOutbound.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          className="h-8 w-20"
                          value={editValue}
                          onChange={(e) => handleEditChange(row.productId, e.target.value)}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2 text-xs"
                          disabled={!dirty || isSaving}
                          onClick={() => handleSaveLeadTime(row)}
                        >
                          {isSaving ? '...' : '저장'}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {row.reorderQty > 0 ? row.reorderQty : '-'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDepletion(row.estimatedDepletionDays)}
                    </TableCell>
                    <TableCell>{statusBadge(row)}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
