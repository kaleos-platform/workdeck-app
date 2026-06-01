'use client'

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PlusIcon } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FloatingActionBar,
  floatingActionButtonClass,
  floatingActionInputClass,
} from '@/components/ui/floating-action-bar'
import { applyRangeSelection } from '@/lib/range-selection'

type ReorderRow = {
  productId: string
  productName: string
  productCode: string | null
  brandId: string | null
  brandName: string | null
  optionId: string
  optionName: string
  sku: string | null
  currentStock: number
  totalOutbound: number
  windowDays: number
  dailyAvgOutbound: number
  leadTimeDays: number
  reorderRoundUnit: number
  safetyStockQty: number
  neededStock: number
  reorderQty: number
  estimatedDepletionDays: number | null
  isUrgent: boolean
  hasConfig: boolean
}

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

// debounce hook
function useDebounce<T>(value: T, delay = 600): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

/**
 * 옵션별 안전재고 인라인 편집 셀.
 * 외부(refetch) 값 변경은 호출부의 key 리셋으로 동기화 (set-state-in-effect 회피).
 */
function SafetyStockCell({
  optionId,
  value: initial,
  onSaved,
}: {
  optionId: string
  value: number
  onSaved: () => void
}) {
  const [value, setValue] = useState(String(initial))
  const debounced = useDebounce(value)
  const initialMount = useRef(true)

  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false
      return
    }
    const n = Number(debounced)
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return
    if (n === initial) return
    ;(async () => {
      try {
        const res = await fetch(`/api/sh/inventory/options/${optionId}/safety-stock`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ safetyStockQty: n }),
        })
        if (!res.ok) throw new Error('저장 실패')
        onSaved()
      } catch (err) {
        console.error(err)
        toast.error('안전재고 저장에 실패했습니다')
      }
    })()
  }, [debounced]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Input
      type="number"
      min={0}
      className="h-7 w-20 text-right tabular-nums"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  )
}

/**
 * ReorderTable — 단일 상품 발주 계획 생성 화면.
 * 상품 헤더는 부모(ReorderPlanCreate)가 표시하므로 여기선 툴바 + 옵션 테이블만 담당.
 * - 툴바: 리드타임(input)·라운딩(select) 인라인 설정 + "발주 계획 시작"
 * - 테이블: 옵션 선택 체크박스 + 안전재고 인라인 편집
 */
export function ReorderTable({ productId }: { productId: string }) {
  const router = useRouter()
  const [rows, setRows] = useState<ReorderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [windowDays, setWindowDays] = useState(90)
  const [creating, setCreating] = useState(false)

  // 선택 옵션 (optionId 키 — refetch 후에도 유지)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastClickedIndexRef = useRef<number | null>(null)

  // 일괄 안전재고 입력
  const [bulkSafetyStock, setBulkSafetyStock] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  // 툴바 설정값
  const [leadTimeInput, setLeadTimeInput] = useState('')
  const [roundUnit, setRoundUnit] = useState('10')
  const [savingLeadTime, setSavingLeadTime] = useState(false)
  const [savingRoundUnit, setSavingRoundUnit] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/inventory/reorder?productId=${productId}`)
      if (!res.ok) throw new Error('불러오기 실패')
      const json = (await res.json()) as { data: ReorderRow[]; windowDays: number }
      setRows(json.data)
      setWindowDays(json.windowDays)
      const first = json.data[0]
      if (first) {
        setLeadTimeInput(String(first.leadTimeDays))
        setRoundUnit(String(first.reorderRoundUnit))
      }
    } catch (err) {
      console.error(err)
      toast.error('발주 예측 데이터를 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const allChecked = rows.length > 0 && selected.size === rows.length
  const someChecked = selected.size > 0 && selected.size < rows.length

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(rows.map((r) => r.optionId)) : new Set())
    },
    [rows]
  )

  // shift+click 범위 선택 — 다른 테이블과 공통 idiom (applyRangeSelection)
  const toggleOne = useCallback(
    (optionId: string, index: number, shiftKey: boolean) => {
      setSelected((prev) =>
        applyRangeSelection(
          prev,
          rows.map((r) => r.optionId),
          optionId,
          index,
          shiftKey,
          lastClickedIndexRef.current
        )
      )
      lastClickedIndexRef.current = index
    },
    [rows]
  )

  // ── 리드타임 저장 (reorderQty 변동 → refetch) ──────────────────────────────
  const handleSaveLeadTime = async () => {
    const n = Number(leadTimeInput)
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      toast.error('리드타임은 0 이상의 정수여야 합니다')
      return
    }
    if (rows[0] && n === rows[0].leadTimeDays) return
    setSavingLeadTime(true)
    try {
      const res = await fetch(`/api/sh/inventory/reorder/config/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadTimeDays: n }),
      })
      if (!res.ok) throw new Error('저장 실패')
      toast.success('리드타임을 저장했습니다')
      await fetchData()
    } catch (err) {
      console.error(err)
      toast.error('리드타임 저장에 실패했습니다')
    } finally {
      setSavingLeadTime(false)
    }
  }

  // ── 라운딩 단위 저장 (미리보기 테이블 reorderQty 무관 → refetch 안 함) ─────
  const handleChangeRoundUnit = async (value: string) => {
    setRoundUnit(value)
    setSavingRoundUnit(true)
    try {
      const res = await fetch(`/api/sh/inventory/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reorderRoundUnit: Number(value) }),
      })
      if (!res.ok) throw new Error('저장 실패')
      toast.success('라운딩 단위를 저장했습니다')
    } catch (err) {
      console.error(err)
      toast.error('라운딩 단위 저장에 실패했습니다')
    } finally {
      setSavingRoundUnit(false)
    }
  }

  // scope 명시 — 'all'은 optionIds 생략(절대 [] 미전송), 'selected'는 선택분만
  const handleCreatePlan = async (scope: 'all' | 'selected') => {
    const optionIds = scope === 'selected' ? Array.from(selected) : undefined
    setCreating(true)
    try {
      const res = await fetch('/api/sh/inventory/reorder/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, ...(optionIds ? { optionIds } : {}) }),
      })
      if (!res.ok) throw new Error('생성 실패')
      const data = (await res.json()) as { planId: string }
      toast.success('발주 계획 초안이 생성되었습니다')
      router.push(`/d/seller-ops/inventory/reorder/plans/${data.planId}`)
    } catch (err) {
      console.error(err)
      toast.error('발주 계획 생성에 실패했습니다')
    } finally {
      setCreating(false)
    }
  }

  // 선택 옵션 안전재고 일괄 설정 (reorderQty 변동 → refetch + 선택 해제)
  const handleBulkSafetyStock = async () => {
    const n = Number(bulkSafetyStock)
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      toast.error('안전재고는 0 이상의 정수여야 합니다')
      return
    }
    if (selected.size === 0) return
    setBulkSaving(true)
    try {
      const res = await fetch('/api/sh/inventory/options/safety-stock', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIds: Array.from(selected), safetyStockQty: n }),
      })
      if (!res.ok) throw new Error('저장 실패')
      const data = (await res.json()) as { updatedCount: number }
      toast.success(`안전재고 ${data.updatedCount}건을 ${n}(으)로 설정했습니다`)
      setBulkSafetyStock('')
      setSelected(new Set())
      await fetchData()
    } catch (err) {
      console.error(err)
      toast.error('안전재고 일괄 설정에 실패했습니다')
    } finally {
      setBulkSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 툴바 — 설정 + 시작 */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">리드타임 (일)</label>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                className="h-8 w-20 text-right tabular-nums"
                value={leadTimeInput}
                onChange={(e) => setLeadTimeInput(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3 text-xs"
                disabled={savingLeadTime}
                onClick={handleSaveLeadTime}
              >
                {savingLeadTime ? '...' : '적용'}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">라운딩 단위</label>
            <Select
              value={roundUnit}
              onValueChange={handleChangeRoundUnit}
              disabled={savingRoundUnit}
            >
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1단위</SelectItem>
                <SelectItem value="10">10단위</SelectItem>
                <SelectItem value="100">100단위</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            기본 {windowDays}일 · 옵션 {rows.length}건
          </span>
          <Button
            size="sm"
            onClick={() => handleCreatePlan('all')}
            disabled={creating || rows.length === 0}
            className="gap-1.5"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {creating ? '생성 중...' : '전체 발주 계획 시작'}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                  onCheckedChange={(v) => toggleAll(v === true)}
                  aria-label="전체 선택"
                />
              </TableHead>
              <TableHead>옵션</TableHead>
              <TableHead>관리코드(SKU)</TableHead>
              <TableHead className="text-right">현재재고</TableHead>
              <TableHead className="text-right">{windowDays}일 출고</TableHead>
              <TableHead className="text-right">일평균</TableHead>
              <TableHead className="text-right">리드타임</TableHead>
              <TableHead className="text-right" title="옵션 단위 안전재고">
                안전재고
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
                  분석할 옵션이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, idx) => {
                const checked = selected.has(row.optionId)
                return (
                  <TableRow
                    key={row.optionId}
                    data-state={checked ? 'selected' : undefined}
                    className={row.isUrgent ? 'bg-red-50/40' : ''}
                  >
                    <TableCell>
                      <Checkbox
                        checked={checked}
                        onClick={(e: React.MouseEvent) => toggleOne(row.optionId, idx, e.shiftKey)}
                        onCheckedChange={() => {}}
                        aria-label={`${row.optionName} 선택`}
                      />
                    </TableCell>
                    <TableCell className="text-sm">{row.optionName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.sku ?? '-'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.currentStock}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.totalOutbound}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.dailyAvgOutbound.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {row.leadTimeDays}일
                    </TableCell>
                    <TableCell className="text-right">
                      <SafetyStockCell
                        key={`ss-${row.optionId}-${row.safetyStockQty}`}
                        optionId={row.optionId}
                        value={row.safetyStockQty}
                        onSaved={fetchData}
                      />
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

      {/* 선택 옵션 일괄 작업 바 — 다른 테이블과 공통(FloatingActionBar) */}
      <FloatingActionBar
        open={selected.size > 0}
        onClear={() => setSelected(new Set())}
        clearDisabled={bulkSaving || creating}
        actions={
          <>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                placeholder="안전재고"
                className={`${floatingActionInputClass} w-24 text-right tabular-nums`}
                value={bulkSafetyStock}
                onChange={(e) => setBulkSafetyStock(e.target.value)}
              />
              <Button
                size="sm"
                variant="ghost"
                className={floatingActionButtonClass}
                onClick={handleBulkSafetyStock}
                disabled={bulkSaving || bulkSafetyStock.trim() === ''}
              >
                {bulkSaving ? '저장 중...' : '안전재고 적용'}
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className={floatingActionButtonClass}
              onClick={() => handleCreatePlan('selected')}
              disabled={creating}
            >
              <PlusIcon className="mr-1 h-3.5 w-3.5" />
              {creating ? '생성 중...' : '선택 발주 계획 시작'}
            </Button>
          </>
        }
      >
        <span className="text-sm font-medium">{selected.size}개 선택</span>
      </FloatingActionBar>
    </div>
  )
}
