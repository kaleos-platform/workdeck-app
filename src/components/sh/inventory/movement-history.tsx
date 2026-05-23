'use client'

import { useCallback, useEffect, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Pencil, Trash2 } from 'lucide-react'

type MovementType = 'INBOUND' | 'OUTBOUND' | 'RETURN' | 'TRANSFER' | 'ADJUSTMENT'

type MovementRow = {
  id: string
  type: MovementType
  quantity: number
  movementDate: string
  orderDate: string | null
  reason: string | null
  referenceId: string | null
  importHistoryId: string | null
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
  const { type, quantity } = row

  if (type === 'INBOUND' || type === 'RETURN') {
    return <span className="text-emerald-600">+{Math.abs(quantity).toLocaleString()}</span>
  }
  if (type === 'OUTBOUND') {
    return <span className="text-red-600">-{Math.abs(quantity).toLocaleString()}</span>
  }
  if (type === 'TRANSFER') {
    return <span className="text-slate-600">{Math.abs(quantity).toLocaleString()}</span>
  }
  // ADJUSTMENT: quantity는 delta
  if (quantity > 0) {
    return <span className="text-emerald-600">+{quantity.toLocaleString()}</span>
  }
  if (quantity < 0) {
    return <span className="text-red-600">{quantity.toLocaleString()}</span>
  }
  return <span>{quantity.toLocaleString()}</span>
}

function isExternalRow(r: MovementRow) {
  // importHistoryId 가 있는 행만 외부 잠금(파일 임포트 출처).
  // referenceId 는 추적용 — 생산 차수 입고 등 내부 출처도 수정/삭제 가능해야 함.
  return r.importHistoryId != null
}

// 수정 다이얼로그 상태
type EditState = {
  open: boolean
  row: MovementRow | null
  quantity: string
  movementDate: string
  reason: string
  orderDate: string
  saving: boolean
}

const EDIT_INIT: EditState = {
  open: false,
  row: null,
  quantity: '',
  movementDate: '',
  reason: '',
  orderDate: '',
  saving: false,
}

export function MovementHistory() {
  const [rows, setRows] = useState<MovementRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const pageSize = 50

  // 필터
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [locationFilter, setLocationFilter] = useState<string>('all')
  const [from, setFrom] = useState<string>('')
  const [to, setTo] = useState<string>('')

  const [locations, setLocations] = useState<LocationItem[]>([])

  // 수정 다이얼로그
  const [edit, setEdit] = useState<EditState>(EDIT_INIT)

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

  // 삭제
  async function handleDelete(r: MovementRow) {
    const ok = window.confirm('이 이동 기록을 삭제하면 재고가 자동 역산됩니다. 진행할까요?')
    if (!ok) return
    try {
      const res = await fetch(`/api/sh/inventory/movements/${r.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err?.error ?? '삭제에 실패했습니다.')
        return
      }
      toast.success('이동 기록이 삭제되었습니다.')
      fetchData()
    } catch {
      toast.error('삭제 중 오류가 발생했습니다.')
    }
  }

  // 수정 다이얼로그 열기
  function openEdit(r: MovementRow) {
    setEdit({
      open: true,
      row: r,
      quantity: String(r.quantity),
      movementDate: r.movementDate ? r.movementDate.slice(0, 10) : '',
      reason: r.reason ?? '',
      orderDate: r.orderDate ? r.orderDate.slice(0, 10) : '',
      saving: false,
    })
  }

  // 수정 저장
  async function handleEditSave() {
    if (!edit.row) return
    const r = edit.row
    const qty = Number(edit.quantity)
    if (isNaN(qty)) {
      toast.error('수량이 올바르지 않습니다.')
      return
    }
    if (r.type !== 'ADJUSTMENT' && qty <= 0) {
      toast.error('조정 외 유형은 양수 수량만 입력할 수 있습니다.')
      return
    }
    if (r.type === 'ADJUSTMENT' && edit.reason.trim() === '') {
      toast.error('조정 유형은 사유를 입력해야 합니다.')
      return
    }

    setEdit((prev) => ({ ...prev, saving: true }))
    try {
      const body: Record<string, unknown> = {
        quantity: qty,
        movementDate: edit.movementDate,
        reason: edit.reason || null,
      }
      if (r.type === 'OUTBOUND' && edit.orderDate) {
        body.orderDate = edit.orderDate
      }
      const res = await fetch(`/api/sh/inventory/movements/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err?.error ?? '수정에 실패했습니다.')
        return
      }
      toast.success('이동 기록이 수정되었습니다.')
      setEdit(EDIT_INIT)
      fetchData()
    } catch {
      toast.error('수정 중 오류가 발생했습니다.')
    } finally {
      setEdit((prev) => ({ ...prev, saving: false }))
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const colSpan = 8 // 날짜·타입·상품/옵션·수량·위치·채널·사유·동작

  return (
    <div className="space-y-4">
      {/* 위치 탭 */}
      <Tabs
        value={locationFilter}
        onValueChange={(v) => {
          setLocationFilter(v)
          setPage(1)
        }}
      >
        <TabsList>
          <TabsTrigger value="all">전체</TabsTrigger>
          {locations.map((l) => (
            <TabsTrigger key={l.id} value={l.id}>
              {l.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 필터바 (유형·시작일·종료일·초기화) */}
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
              <TableHead className="min-w-[280px]">사유</TableHead>
              <TableHead className="w-24">동작</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                  로딩 중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                  등록된 이동 기록이 없습니다. + 새 이동 기록 버튼으로 추가하세요.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const external = isExternalRow(r)
                return (
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
                      {r.reason ? (
                        <span
                          className="block max-w-[280px] break-words whitespace-normal"
                          title={r.reason}
                        >
                          {r.reason}
                        </span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={external}
                          title={
                            external
                              ? '외부 출처(파일 업로드/대조)로 생성된 행은 수정할 수 없습니다'
                              : '수정'
                          }
                          onClick={() => openEdit(r)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={external}
                          title={
                            external
                              ? '외부 출처(파일 업로드/대조)로 생성된 행은 수정할 수 없습니다'
                              : '삭제'
                          }
                          className="hover:text-red-600"
                          onClick={() => handleDelete(r)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
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

      {/* 수정 다이얼로그 */}
      <Dialog open={edit.open} onOpenChange={(o) => !o && setEdit(EDIT_INIT)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>이동 기록 수정</DialogTitle>
          </DialogHeader>
          {edit.row && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="edit-qty" className="text-sm">
                  수량
                  {edit.row.type !== 'ADJUSTMENT' && (
                    <span className="ml-1 text-xs text-muted-foreground">(양수만)</span>
                  )}
                  {edit.row.type === 'ADJUSTMENT' && (
                    <span className="ml-1 text-xs text-muted-foreground">(음수 허용)</span>
                  )}
                </Label>
                <Input
                  id="edit-qty"
                  type="number"
                  value={edit.quantity}
                  onChange={(e) => setEdit((prev) => ({ ...prev, quantity: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-date" className="text-sm">
                  이동 일자
                </Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={edit.movementDate}
                  onChange={(e) => setEdit((prev) => ({ ...prev, movementDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-reason" className="text-sm">
                  사유
                  {edit.row.type === 'ADJUSTMENT' ? (
                    <span className="ml-1 text-xs text-red-500">*필수</span>
                  ) : (
                    <span className="ml-1 text-xs text-muted-foreground">(선택)</span>
                  )}
                </Label>
                <Textarea
                  id="edit-reason"
                  value={edit.reason}
                  onChange={(e) => setEdit((prev) => ({ ...prev, reason: e.target.value }))}
                  rows={3}
                />
              </div>
              {edit.row.type === 'OUTBOUND' && (
                <div className="space-y-1">
                  <Label htmlFor="edit-orderdate" className="text-sm">
                    주문 일자
                    <span className="ml-1 text-xs text-muted-foreground">(선택)</span>
                  </Label>
                  <Input
                    id="edit-orderdate"
                    type="date"
                    value={edit.orderDate}
                    onChange={(e) => setEdit((prev) => ({ ...prev, orderDate: e.target.value }))}
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(EDIT_INIT)} disabled={edit.saving}>
              취소
            </Button>
            <Button onClick={handleEditSave} disabled={edit.saving}>
              {edit.saving ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
