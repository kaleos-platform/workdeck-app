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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type MovementType = 'INBOUND' | 'OUTBOUND' | 'RETURN' | 'TRANSFER' | 'ADJUSTMENT'

type MovementRow = {
  id: string
  type: MovementType
  quantity: number
  movementDate: string
  orderDate: string | null
  reason: string | null
  option: {
    id: string
    name: string
    sku: string | null
    product: { id: string; name: string; code: string | null }
  } | null
  location: { id: string; name: string } | null
  toLocation: { id: string; name: string } | null
  channel: { id: string; name: string } | null
}

type LocationItem = { id: string; name: string }

const TYPE_LABEL: Record<MovementType, string> = {
  INBOUND: '입고',
  OUTBOUND: '출고',
  RETURN: '반품',
  TRANSFER: '이동',
  ADJUSTMENT: '조정',
}

function typeBadge(type: MovementType) {
  const map: Record<MovementType, string> = {
    INBOUND: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    OUTBOUND: 'border-red-300 bg-red-50 text-red-700',
    RETURN: 'border-blue-300 bg-blue-50 text-blue-700',
    TRANSFER: 'border-yellow-300 bg-yellow-50 text-yellow-700',
    ADJUSTMENT: 'border-purple-300 bg-purple-50 text-purple-700',
  }
  return (
    <Badge variant="outline" className={`text-[11px] ${map[type]}`}>
      {TYPE_LABEL[type]}
    </Badge>
  )
}

function formatDate(d: string | null | undefined) {
  if (!d) return '-'
  try {
    return new Date(d).toISOString().split('T')[0]
  } catch {
    return '-'
  }
}

function quantityDisplay(row: MovementRow) {
  const t = row.type
  const sign =
    t === 'INBOUND' || t === 'RETURN' ? '+' : t === 'OUTBOUND' ? '-' : t === 'ADJUSTMENT' ? '=' : ''
  const cls =
    t === 'INBOUND' || t === 'RETURN' ? 'text-emerald-600' : t === 'OUTBOUND' ? 'text-red-600' : ''
  return (
    <span className={cls}>
      {sign}
      {Math.abs(row.quantity).toLocaleString()}
    </span>
  )
}

export function MovementHistory() {
  const [rows, setRows] = useState<MovementRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const pageSize = 50

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [locationFilter, setLocationFilter] = useState<string>('all')
  const [from, setFrom] = useState<string>('')
  const [to, setTo] = useState<string>('')

  const [locations, setLocations] = useState<LocationItem[]>([])

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/sh/inventory/locations')
        if (!res.ok) return
        const data = await res.json()
        setLocations(data.locations ?? [])
      } catch {
        // ignore
      }
    })()
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      if (typeFilter !== 'all') params.set('type', typeFilter)
      if (locationFilter !== 'all') params.set('locationId', locationFilter)
      if (from) params.set('from', from)
      if (to) params.set('to', to)

      const res = await fetch(`/api/sh/inventory/movements?${params}`)
      if (!res.ok) {
        setRows([])
        setTotal(0)
        return
      }
      const data = await res.json()
      setRows(data.data ?? [])
      setTotal(data.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [page, typeFilter, locationFilter, from, to])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  function resetFilters() {
    setTypeFilter('all')
    setLocationFilter('all')
    setFrom('')
    setTo('')
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">유형</Label>
          <Select
            value={typeFilter}
            onValueChange={(v) => {
              setTypeFilter(v)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-[130px]" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="INBOUND">입고</SelectItem>
              <SelectItem value="OUTBOUND">출고</SelectItem>
              <SelectItem value="RETURN">반품</SelectItem>
              <SelectItem value="TRANSFER">이동</SelectItem>
              <SelectItem value="ADJUSTMENT">조정</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">위치</Label>
          <Select
            value={locationFilter}
            onValueChange={(v) => {
              setLocationFilter(v)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-[160px]" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">시작일</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setPage(1)
            }}
            className="h-8 w-[150px]"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">종료일</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              setPage(1)
            }}
            className="h-8 w-[150px]"
          />
        </div>
        <Button variant="outline" size="sm" onClick={resetFilters}>
          초기화
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>날짜</TableHead>
              <TableHead>타입</TableHead>
              <TableHead className="min-w-[220px]">상품 / 옵션</TableHead>
              <TableHead className="text-right">수량</TableHead>
              <TableHead>위치</TableHead>
              <TableHead>채널</TableHead>
              <TableHead>사유</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  로딩 중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  등록된 이동 기록이 없습니다. + 새 이동 기록 버튼으로 추가하세요.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatDate(r.movementDate)}
                  </TableCell>
                  <TableCell>{typeBadge(r.type)}</TableCell>
                  <TableCell>
                    <div className="max-w-[320px]">
                      <p className="truncate text-sm font-medium">
                        {r.option?.product?.name ?? '-'}
                      </p>
                      {r.option?.name && (
                        <p className="truncate text-xs text-muted-foreground">
                          {r.option.name}
                          {r.option.sku ? ` · ${r.option.sku}` : ''}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {quantityDisplay(r)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.type === 'TRANSFER' && r.toLocation ? (
                      <span>
                        {r.location?.name ?? '-'} → {r.toLocation.name}
                      </span>
                    ) : (
                      (r.location?.name ?? '-')
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.type === 'OUTBOUND' ? (r.channel?.name ?? '-') : '-'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.type === 'ADJUSTMENT' && r.reason ? (
                      <span className="line-clamp-1 max-w-[200px]" title={r.reason}>
                        {r.reason}
                      </span>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {total > pageSize && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">총 {total.toLocaleString()}건</p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              이전
            </Button>
            <span className="text-sm text-muted-foreground">
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
