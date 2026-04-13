'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

type ReorderRow = {
  optionId: string
  productId: string
  productName: string
  productCode: string | null
  optionName: string
  optionSku: string | null
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
}

type Filter = 'all' | 'needed' | 'urgent'

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

  const fetchData = useCallback(async (f: Filter) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (f === 'needed') params.set('reorderNeededOnly', 'true')
      if (f === 'urgent') params.set('urgentOnly', 'true')
      const qs = params.toString()
      const res = await fetch(`/api/inv/reorder${qs ? `?${qs}` : ''}`)
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
    fetchData(filter)
  }, [filter, fetchData])

  const handleEditChange = (optionId: string, value: string) => {
    const n = Number(value)
    setEditing((prev) => ({ ...prev, [optionId]: Number.isFinite(n) ? n : 0 }))
  }

  const handleSaveLeadTime = async (row: ReorderRow) => {
    const next = editing[row.optionId]
    if (next === undefined || next === row.leadTimeDays) return
    if (next < 0) {
      toast.error('리드타임은 0 이상이어야 합니다')
      return
    }
    setSaving((s) => ({ ...s, [row.optionId]: true }))
    try {
      const res = await fetch(`/api/inv/reorder/config/${row.optionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadTimeDays: next }),
      })
      if (!res.ok) throw new Error('저장 실패')
      toast.success('리드타임을 저장했습니다')
      await fetchData(filter)
    } catch (err) {
      console.error(err)
      toast.error('리드타임 저장에 실패했습니다')
    } finally {
      setSaving((s) => ({ ...s, [row.optionId]: false }))
    }
  }

  const counts = useMemo(() => {
    const needed = rows.filter((r) => r.reorderQty > 0).length
    const urgent = rows.filter((r) => r.isUrgent).length
    return { total: rows.length, needed, urgent }
  }, [rows])

  return (
    <div className="space-y-4">
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
          분석 기간 기본 {windowDays}일 · 총 {counts.total}건 · 발주 필요 {counts.needed}건 · 긴급 {counts.urgent}건
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>상품</TableHead>
              <TableHead>옵션</TableHead>
              <TableHead>제품코드</TableHead>
              <TableHead className="text-right">현재재고</TableHead>
              <TableHead className="text-right">90일 출고</TableHead>
              <TableHead className="text-right">일평균</TableHead>
              <TableHead className="w-[180px]">리드타임(일)</TableHead>
              <TableHead className="text-right">발주 필요량</TableHead>
              <TableHead className="text-right">예상 소진일</TableHead>
              <TableHead>상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                  분석할 출고 데이터가 없습니다
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const editValue = editing[row.optionId] ?? row.leadTimeDays
                const dirty = editValue !== row.leadTimeDays
                const isSaving = saving[row.optionId] === true
                return (
                  <TableRow key={row.optionId} className={row.isUrgent ? 'bg-red-50/40' : ''}>
                    <TableCell className="font-medium">{row.productName}</TableCell>
                    <TableCell>{row.optionName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.productCode ?? '-'}
                    </TableCell>
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
                          onChange={(e) => handleEditChange(row.optionId, e.target.value)}
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
                    <TableCell className="text-right tabular-nums font-semibold">
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
