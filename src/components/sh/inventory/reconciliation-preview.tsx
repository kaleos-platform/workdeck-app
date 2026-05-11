'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { FloatingActionBar, floatingActionButtonClass } from '@/components/ui/floating-action-bar'
import {
  OptionPickerDialog,
  type PickedOptionWithQty,
} from '@/components/sh/products/listings/option-picker-dialog'
import { applyRangeSelection } from '@/lib/range-selection'
import { reconStatusBadge, type ReconStatus } from './recon-status-display'

type ParsedRow = {
  externalCode: string
  externalName?: string
  externalOptionName?: string
  quantity: number
}

type SuggestionOption = {
  optionId: string
  productName: string
  optionName: string
}

type MappingItem = {
  optionId: string
  quantity: number
  productName: string
  optionName: string
}

type MatchEntry =
  | {
      status: 'matched-diff'
      row: ParsedRow
      optionId: string
      productName: string
      optionName: string
      mapItemQuantity: number
      systemQuantity: number
      fileQuantity: number
      delta: number
      mappingId?: string
      mappingItems?: MappingItem[]
    }
  | {
      status: 'matched-equal'
      row: ParsedRow
      optionId: string
      productName: string
      optionName: string
      mapItemQuantity: number
      systemQuantity: number
      fileQuantity: number
      mappingId?: string
      mappingItems?: MappingItem[]
    }
  | {
      status: 'file-only'
      row: ParsedRow
      suggestions: SuggestionOption[]
    }
  | {
      status: 'system-only'
      optionId: string
      productName: string
      optionName: string
      systemQuantity: number
    }

type Reconciliation = {
  id: string
  fileName: string
  snapshotDate: string
  status: ReconStatus
  totalItems: number
  matchedItems: number
  adjustedItems: number
  appliedOptionIds: string[]
  location: { id: string; name: string }
  matchResults: MatchEntry[]
}

type Props = {
  reconciliationId: string
  onClose: () => void
  onConfirmed: () => void
}

type UnifiedEntry = {
  key: string
  status: string
  productName: string
  optionName: string
  systemQty: number | null
  fileQty: number | null
  delta: number | null
  optionId?: string
  externalCode?: string
  suggestions?: SuggestionOption[]
  row?: ParsedRow
  mappingId?: string
  mappingItems?: MappingItem[]
  mapItemQuantity?: number
}

const STATUS_FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'matched-diff', label: '차이있음' },
  { value: 'matched-equal', label: '일치' },
  { value: 'file-only', label: '미매칭' },
  { value: 'system-only', label: '파일 누락' },
] as const

function entryStatusBadge(status: string) {
  switch (status) {
    case 'matched-diff':
      return <Badge className="border-amber-200 bg-amber-100 text-amber-700">차이있음</Badge>
    case 'matched-equal':
      return <Badge className="border-green-200 bg-green-100 text-green-700">일치</Badge>
    case 'file-only':
      return <Badge className="border-red-200 bg-red-100 text-red-700">미매칭</Badge>
    case 'system-only':
      return <Badge className="border-gray-200 bg-gray-100 text-gray-600">파일 누락</Badge>
    default:
      return null
  }
}

function isSelectable(status: string) {
  return status === 'matched-diff'
}

function manualItemsToLabel(items: PickedOptionWithQty[]): string {
  if (items.length === 0) return '-'
  const first = `${items[0].productName} / ${items[0].optionName}${items[0].quantity > 1 ? ` × ${items[0].quantity}` : ''}`
  if (items.length === 1) return first
  return `${first} 외 ${items.length - 1}개`
}

export function ReconciliationPreview({ reconciliationId, onClose, onConfirmed }: Props) {
  const [recon, setRecon] = useState<Reconciliation | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'matched-diff' | 'matched-equal' | 'file-only' | 'system-only'
  >('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // externalCode → PickedOptionWithQty[] (다중 옵션+수량)
  const [manualMap, setManualMap] = useState<Record<string, PickedOptionWithQty[]>>({})

  const lastClickedIndexRef = useRef<number | null>(null)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerExternalCode, setPickerExternalCode] = useState<string | null>(null)
  const [pickerContext, setPickerContext] = useState('')

  // matched-* 행 매칭 수정용 picker 상태
  const [editMatcherOpen, setEditMatcherOpen] = useState(false)
  const [editMatcherEntry, setEditMatcherEntry] = useState<UnifiedEntry | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/inventory/reconciliation/${reconciliationId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '조회 실패')
      const r = data.reconciliation as Reconciliation
      setRecon(r)
      const appliedSet = new Set(r.appliedOptionIds ?? [])
      const diffKeys = (r.matchResults ?? [])
        .filter(
          (e): e is Extract<MatchEntry, { status: 'matched-diff' }> => e.status === 'matched-diff'
        )
        .filter((e) => !appliedSet.has(e.optionId))
        .map((e) => `diff-${e.optionId}`)
      setSelected(new Set(diffKeys))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [reconciliationId])

  useEffect(() => {
    load()
  }, [load])

  const entries = useMemo(() => recon?.matchResults ?? [], [recon])
  const appliedOptionIds = useMemo(() => recon?.appliedOptionIds ?? [], [recon])

  const diffEntries = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<MatchEntry, { status: 'matched-diff' }> => e.status === 'matched-diff'
      ),
    [entries]
  )
  const equalEntries = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<MatchEntry, { status: 'matched-equal' }> => e.status === 'matched-equal'
      ),
    [entries]
  )
  const fileOnlyEntries = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<MatchEntry, { status: 'file-only' }> => e.status === 'file-only'
      ),
    [entries]
  )
  const systemOnlyEntries = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<MatchEntry, { status: 'system-only' }> => e.status === 'system-only'
      ),
    [entries]
  )

  const counts = {
    all: entries.length,
    'matched-diff': diffEntries.length,
    'matched-equal': equalEntries.length,
    'file-only': fileOnlyEntries.length,
    'system-only': systemOnlyEntries.length,
  }

  const unifiedEntries = useMemo<UnifiedEntry[]>(() => {
    const result: UnifiedEntry[] = []

    for (const e of diffEntries) {
      result.push({
        key: `diff-${e.optionId}`,
        status: 'matched-diff',
        productName: e.productName,
        optionName: e.optionName,
        systemQty: e.systemQuantity,
        fileQty: e.fileQuantity,
        delta: e.delta,
        optionId: e.optionId,
        row: e.row,
        mappingId: e.mappingId,
        mappingItems: e.mappingItems,
        mapItemQuantity: e.mapItemQuantity,
      })
    }

    for (const e of equalEntries) {
      result.push({
        key: `equal-${e.optionId}`,
        status: 'matched-equal',
        productName: e.productName,
        optionName: e.optionName,
        systemQty: e.systemQuantity,
        fileQty: e.fileQuantity,
        delta: 0,
        optionId: e.optionId,
        row: e.row,
        mappingId: e.mappingId,
        mappingItems: e.mappingItems,
        mapItemQuantity: e.mapItemQuantity,
      })
    }

    for (const e of fileOnlyEntries) {
      const code = e.row.externalCode
      const items = manualMap[code]
      const isMapped = items && items.length > 0

      const displayProductName = isMapped
        ? items[0].productName
        : (e.row.externalName ?? e.row.externalCode)
      const displayOptionName = isMapped
        ? manualItemsToLabel(items)
        : (e.row.externalOptionName ?? '-')

      result.push({
        key: `file-${code}`,
        status: 'file-only',
        productName: displayProductName,
        optionName: displayOptionName,
        systemQty: null,
        fileQty: e.row.quantity,
        delta: null,
        externalCode: code,
        suggestions: e.suggestions,
        row: e.row,
      })
    }

    for (const e of systemOnlyEntries) {
      result.push({
        key: `sys-${e.optionId}`,
        status: 'system-only',
        productName: e.productName,
        optionName: e.optionName,
        systemQty: e.systemQuantity,
        fileQty: null,
        delta: null,
        optionId: e.optionId,
      })
    }

    return result
  }, [diffEntries, equalEntries, fileOnlyEntries, systemOnlyEntries, manualMap])

  const filteredEntries = useMemo(
    () =>
      statusFilter === 'all'
        ? unifiedEntries
        : unifiedEntries.filter((e) => {
            if (statusFilter === 'file-only') {
              return e.status === 'file-only'
            }
            return e.status === statusFilter
          }),
    [unifiedEntries, statusFilter]
  )

  const isApplied = useCallback(
    (entry: UnifiedEntry): boolean => {
      if (entry.optionId && appliedOptionIds.includes(entry.optionId)) return true
      if (entry.externalCode) {
        const items = manualMap[entry.externalCode]
        if (items && items.length > 0) {
          return items.every((i) => appliedOptionIds.includes(i.optionId))
        }
      }
      return false
    },
    [appliedOptionIds, manualMap]
  )

  const selectableKeys = useMemo(
    () =>
      filteredEntries
        .filter((e) => isSelectable(e.status))
        .filter((e) => !isApplied(e))
        .map((e) => e.key),
    [filteredEntries, isApplied]
  )

  const allSelected = selectableKeys.length > 0 && selectableKeys.every((k) => selected.has(k))

  function toggleSelectAll() {
    if (allSelected) {
      setSelected((s) => {
        const next = new Set(s)
        selectableKeys.forEach((k) => next.delete(k))
        return next
      })
    } else {
      setSelected((s) => {
        const next = new Set(s)
        selectableKeys.forEach((k) => next.add(k))
        return next
      })
    }
  }

  function toggleSelect(key: string, index: number, shiftKey: boolean) {
    setSelected((prev) =>
      applyRangeSelection(prev, selectableKeys, key, index, shiftKey, lastClickedIndexRef.current)
    )
    lastClickedIndexRef.current = index
  }

  function openPicker(entry: UnifiedEntry) {
    if (!entry.externalCode) return
    setPickerExternalCode(entry.externalCode)
    const name = entry.row?.externalName ?? entry.externalCode
    const optionName = entry.row?.externalOptionName
    setPickerContext(optionName ? `${name} / ${optionName}` : name)
    setPickerOpen(true)
  }

  function handlePickedMulti(items: PickedOptionWithQty[]) {
    if (!pickerExternalCode) return
    const code = pickerExternalCode
    setManualMap((m) => ({ ...m, [code]: items }))
    setSelected((s) => {
      const next = new Set(s)
      next.add(`file-${code}`)
      return next
    })
    setPickerOpen(false)
    const label = manualItemsToLabel(items)
    toast.success(`${label} 매칭됨`)
  }

  function openEditMatcher(entry: UnifiedEntry) {
    setEditMatcherEntry(entry)
    setEditMatcherOpen(true)
  }

  // mappingItems → PickedOptionWithQty[] 변환 (sku 등 불필요 필드는 null/0)
  function mappingItemsToPickedWithQty(items: MappingItem[]): PickedOptionWithQty[] {
    return items.map((i) => ({
      optionId: i.optionId,
      optionName: i.optionName,
      productId: '',
      productName: i.productName,
      sku: null,
      brandName: null,
      retailPrice: null,
      totalStock: 0,
      quantity: i.quantity,
    }))
  }

  async function handleEditMatcherPickMulti(items: PickedOptionWithQty[]) {
    if (!editMatcherEntry || !recon) return
    const entry = editMatcherEntry
    setEditMatcherOpen(false)
    setEditMatcherEntry(null)

    if (!entry.mappingId) {
      toast.error('이 행에는 수정 가능한 매핑이 없습니다')
      return
    }

    try {
      const res = await fetch(
        `/api/sh/inventory/locations/${recon.location.id}/mappings?mappingId=${entry.mappingId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: items.map((i) => ({ optionId: i.optionId, quantity: i.quantity })),
          }),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '매핑 수정 실패')
      toast.success(`${manualItemsToLabel(items)} 으로 매칭 변경됨`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '매핑 수정 실패')
    }
  }

  function removeMapping(externalCode: string) {
    setManualMap((m) => {
      const next = { ...m }
      delete next[externalCode]
      return next
    })
    setSelected((s) => {
      const next = new Set(s)
      next.delete(`file-${externalCode}`)
      return next
    })
  }

  const excludeOptionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const e of entries) {
      if ('optionId' in e && e.optionId) ids.add(e.optionId)
    }
    for (const items of Object.values(manualMap)) {
      for (const i of items) ids.add(i.optionId)
    }
    return [...ids]
  }, [entries, manualMap])

  async function handleConfirm() {
    if (!recon) return
    setSubmitting(true)
    try {
      const manualMappings = Object.entries(manualMap)
        .filter(([, items]) => items.length > 0)
        .map(([externalCode, items]) => ({
          externalCode,
          items: items.map((i) => ({ optionId: i.optionId, quantity: i.quantity })),
        }))

      const selectedOptionIds: string[] = []
      for (const key of selected) {
        if (key.startsWith('diff-')) {
          selectedOptionIds.push(key.slice(5))
        } else if (key.startsWith('file-')) {
          const items = manualMap[key.slice(5)]
          if (items) {
            for (const i of items) selectedOptionIds.push(i.optionId)
          }
        }
      }

      const res = await fetch(`/api/sh/inventory/reconciliation/${recon.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          selectedOptionIds,
          manualMappings,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '적용 실패')
      toast.success(`${data.adjustedCount}건 조정 완료`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '적용 실패')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleFinalize() {
    if (!recon) return
    if (!confirm('확정하면 더 이상 수정할 수 없습니다. 진행할까요?')) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/sh/inventory/reconciliation/${recon.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'finalize' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '확정 실패')
      toast.success('확정되었습니다')
      onConfirmed()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '확정 실패')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel() {
    if (!recon) return
    if (!confirm('이 대조를 취소하시겠습니까?')) return
    try {
      const res = await fetch(`/api/sh/inventory/reconciliation/${recon.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '취소 실패')
      toast.success('취소되었습니다')
      onConfirmed()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '취소 실패')
    }
  }

  if (loading || !recon) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const canEdit = ['PENDING', 'PARTIAL'].includes(recon.status)
  const canFinalize = recon.status === 'APPLIED'
  const appliedCount = appliedOptionIds.length

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">{recon.fileName}</h2>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {recon.location.name} · 기준일{' '}
              {new Date(recon.snapshotDate).toISOString().slice(0, 10)}
            </span>
            {reconStatusBadge(recon.status)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            총 {recon.totalItems}건 · 자동매칭 {recon.matchedItems}건 · 조정 {recon.adjustedItems}건
            {appliedCount > 0 && ` · 적용 ${appliedCount}건`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canFinalize && (
            <Button size="sm" onClick={handleFinalize} disabled={submitting}>
              {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              확정
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>

      <div className="flex gap-1 rounded-lg border bg-muted p-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === f.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {f.label}
            <span className="ml-1.5 text-xs opacity-70">{counts[f.value]}</span>
          </button>
        ))}
      </div>

      {filteredEntries.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          해당 상태의 항목이 없습니다
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  {canEdit && selectableKeys.length > 0 && (
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="전체 선택"
                    />
                  )}
                </TableHead>
                <TableHead className="w-28">상태</TableHead>
                <TableHead>상품명</TableHead>
                <TableHead>옵션명</TableHead>
                <TableHead className="w-20 text-right">현재 재고</TableHead>
                <TableHead className="w-20 text-right">파일</TableHead>
                <TableHead className="w-20 text-right">차이</TableHead>
                <TableHead className="w-28">동작</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((entry, index) => {
                const selectable = isSelectable(entry.status)
                const applied = isApplied(entry)
                const selectKey = entry.key
                const isMapped =
                  entry.externalCode !== undefined &&
                  (manualMap[entry.externalCode]?.length ?? 0) > 0

                return (
                  <TableRow key={entry.key} className={applied ? 'bg-green-50/30' : undefined}>
                    <TableCell>
                      {canEdit && selectable && (
                        <Checkbox
                          checked={selected.has(selectKey)}
                          disabled={applied}
                          onClick={
                            applied
                              ? undefined
                              : (e) => {
                                  toggleSelect(selectKey, index, e.shiftKey)
                                }
                          }
                          aria-label="행 선택"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {entryStatusBadge(entry.status)}
                        {applied && (
                          <Badge
                            variant="outline"
                            className="border-green-400 text-[10px] text-green-600"
                          >
                            적용됨
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{entry.productName}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {entry.optionName}
                          {/* matched-* 행: 수량 비율이 1 초과인 경우 표시 */}
                          {(entry.status === 'matched-equal' || entry.status === 'matched-diff') &&
                            entry.mapItemQuantity !== undefined &&
                            entry.mapItemQuantity > 1 && (
                              <span className="ml-1 text-xs text-muted-foreground/70">
                                × {entry.mapItemQuantity}
                              </span>
                            )}
                        </span>
                        {canEdit && isMapped && entry.externalCode && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => openPicker(entry)}
                            >
                              수정
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                              onClick={() => removeMapping(entry.externalCode!)}
                            >
                              취소
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.systemQty !== null ? entry.systemQty : '-'}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {entry.fileQty !== null ? entry.fileQty : '-'}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono ${
                        entry.delta !== null
                          ? entry.delta > 0
                            ? 'text-emerald-600'
                            : entry.delta < 0
                              ? 'text-red-600'
                              : ''
                          : ''
                      }`}
                    >
                      {entry.delta !== null ? `${entry.delta > 0 ? '+' : ''}${entry.delta}` : '-'}
                    </TableCell>
                    <TableCell>
                      {canEdit &&
                        (entry.status === 'matched-equal' || entry.status === 'matched-diff') &&
                        entry.mappingId && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => openEditMatcher(entry)}
                          >
                            매칭 수정
                          </Button>
                        )}
                      {canEdit && entry.status === 'file-only' && entry.externalCode && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => openPicker(entry)}
                          >
                            <Search className="mr-1 h-3 w-3" />
                            상품 선택
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {canEdit && (
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={handleCancel} disabled={submitting}>
            대조 취소
          </Button>
        </div>
      )}

      {canEdit && (
        <FloatingActionBar
          open={selected.size > 0}
          onClear={() => setSelected(new Set())}
          actions={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={floatingActionButtonClass}
              onClick={handleConfirm}
              disabled={submitting}
            >
              {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              선택 적용
            </Button>
          }
        >
          <span className="text-sm font-semibold">{selected.size}건 선택</span>
        </FloatingActionBar>
      )}

      {/* file-only 행 수동 매칭 picker */}
      <OptionPickerDialog
        open={pickerOpen}
        onOpenChange={(v) => {
          if (!v) setPickerOpen(false)
        }}
        mode="multi-with-qty"
        onPickMulti={handlePickedMulti}
        excludeOptionIds={excludeOptionIds}
        contextLabel="매칭 대상 (파일)"
        contextValue={pickerContext}
        initialItems={
          pickerExternalCode && manualMap[pickerExternalCode]
            ? manualMap[pickerExternalCode]
            : undefined
        }
      />

      {/* matched-* 행 매칭 수정용 picker */}
      <OptionPickerDialog
        open={editMatcherOpen}
        onOpenChange={(v) => {
          if (!v) {
            setEditMatcherOpen(false)
            setEditMatcherEntry(null)
          }
        }}
        mode="multi-with-qty"
        onPickMulti={handleEditMatcherPickMulti}
        excludeOptionIds={excludeOptionIds}
        contextLabel="현재 매칭"
        contextValue={
          editMatcherEntry ? `${editMatcherEntry.productName} / ${editMatcherEntry.optionName}` : ''
        }
        initialItems={
          editMatcherEntry?.mappingItems
            ? mappingItemsToPickedWithQty(editMatcherEntry.mappingItems)
            : undefined
        }
      />
    </div>
  )
}
