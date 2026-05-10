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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FloatingActionBar, floatingActionButtonClass } from '@/components/ui/floating-action-bar'
import {
  OptionPickerDialog,
  type PickedOption,
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

type MatchEntry =
  | {
      status: 'matched-diff'
      row: ParsedRow
      optionId: string
      productName: string
      optionName: string
      systemQuantity: number
      fileQuantity: number
      delta: number
    }
  | {
      status: 'matched-equal'
      row: ParsedRow
      optionId: string
      productName: string
      optionName: string
      systemQuantity: number
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

type ManualMeta = {
  productName: string
  optionName: string
  systemQty?: number
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
    case 'manual-equal':
      return <Badge className="border-green-200 bg-green-50 text-green-600">수동 일치</Badge>
    case 'manual-diff':
      return <Badge className="border-amber-200 bg-amber-50 text-amber-600">수동 차이</Badge>
    default:
      return null
  }
}

function isSelectable(status: string) {
  return status === 'matched-diff' || status === 'manual-equal' || status === 'manual-diff'
}

export function ReconciliationPreview({ reconciliationId, onClose, onConfirmed }: Props) {
  const [recon, setRecon] = useState<Reconciliation | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'matched-diff' | 'matched-equal' | 'file-only' | 'system-only'
  >('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [manualMap, setManualMap] = useState<Record<string, string>>({})
  const [manualMeta, setManualMeta] = useState<Record<string, ManualMeta>>({})

  const lastClickedIndexRef = useRef<number | null>(null)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerExternalCode, setPickerExternalCode] = useState<string | null>(null)
  const [pickerContext, setPickerContext] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/inventory/reconciliation/${reconciliationId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '조회 실패')
      const r = data.reconciliation as Reconciliation
      setRecon(r)
      // 이미 적용된 optionId는 초기 선택에서 제외
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
  const equalEntries = useMemo(() => entries.filter((e) => e.status === 'matched-equal'), [entries])
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
      })
    }

    for (const e of equalEntries) {
      if (e.status === 'matched-equal') {
        result.push({
          key: `equal-${e.optionId}`,
          status: 'matched-equal',
          productName: e.productName,
          optionName: e.optionName,
          systemQty: e.systemQuantity,
          fileQty: e.row.quantity,
          delta: 0,
          optionId: e.optionId,
          row: e.row,
        })
      }
    }

    for (const e of fileOnlyEntries) {
      const code = e.row.externalCode
      const mapped = manualMap[code]
      const meta = manualMeta[code]

      let status = 'file-only'
      let displayProductName = e.row.externalName ?? e.row.externalCode
      let displayOptionName = e.row.externalOptionName ?? '-'
      let systemQty: number | null = null
      let delta: number | null = null

      if (mapped && meta) {
        displayProductName = meta.productName
        displayOptionName = meta.optionName
        if (meta.systemQty !== undefined) {
          systemQty = meta.systemQty
          const diff = e.row.quantity - meta.systemQty
          delta = diff
          status = diff === 0 ? 'manual-equal' : 'manual-diff'
        }
      }

      result.push({
        key: `file-${code}`,
        status,
        productName: displayProductName,
        optionName: displayOptionName,
        systemQty,
        fileQty: e.row.quantity,
        delta,
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
  }, [diffEntries, equalEntries, fileOnlyEntries, systemOnlyEntries, manualMap, manualMeta])

  const filteredEntries = useMemo(
    () =>
      statusFilter === 'all'
        ? unifiedEntries
        : unifiedEntries.filter((e) => {
            if (statusFilter === 'file-only') {
              return (
                e.status === 'file-only' ||
                e.status === 'manual-equal' ||
                e.status === 'manual-diff'
              )
            }
            return e.status === statusFilter
          }),
    [unifiedEntries, statusFilter]
  )

  // 적용된 행인지 판단
  const isApplied = useCallback(
    (entry: UnifiedEntry): boolean => {
      if (entry.optionId && appliedOptionIds.includes(entry.optionId)) return true
      if (
        entry.externalCode &&
        manualMap[entry.externalCode] &&
        appliedOptionIds.includes(manualMap[entry.externalCode])
      )
        return true
      return false
    },
    [appliedOptionIds, manualMap]
  )

  // 이미 적용된 행은 선택 대상에서 제외
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

  function handlePicked(picked: PickedOption) {
    if (!pickerExternalCode) return
    const code = pickerExternalCode
    setManualMap((m) => ({ ...m, [code]: picked.optionId }))
    setManualMeta((m) => ({
      ...m,
      [code]: {
        productName: picked.productName,
        optionName: picked.optionName,
        systemQty: picked.totalStock,
      },
    }))
    setSelected((s) => {
      const next = new Set(s)
      next.add(`file-${code}`)
      return next
    })
    setPickerOpen(false)
    toast.success(`${picked.productName} / ${picked.optionName} 매칭됨`)
  }

  function removeMapping(externalCode: string) {
    setManualMap((m) => {
      const next = { ...m }
      delete next[externalCode]
      return next
    })
    setManualMeta((m) => {
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
    for (const v of Object.values(manualMap)) {
      if (v) ids.add(v)
    }
    return [...ids]
  }, [entries, manualMap])

  // confirm (PENDING/PARTIAL → 적용, 결과에 따라 PARTIAL/APPLIED)
  // confirm 후에는 recon을 재조회해 상태 반영 (프리뷰 닫지 않음)
  async function handleConfirm() {
    if (!recon) return
    setSubmitting(true)
    try {
      const manualMappings = Object.entries(manualMap)
        .filter(([, v]) => !!v)
        .map(([externalCode, optionId]) => ({ externalCode, optionId }))

      const selectedOptionIds: string[] = []
      for (const key of selected) {
        if (key.startsWith('diff-')) {
          selectedOptionIds.push(key.slice(5))
        } else if (key.startsWith('file-')) {
          const optionId = manualMap[key.slice(5)]
          if (optionId) selectedOptionIds.push(optionId)
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
      // 재조회로 appliedOptionIds + 새 상태 반영
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '적용 실패')
    } finally {
      setSubmitting(false)
    }
  }

  // finalize (APPLIED → CONFIRMED)
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

      {/* Status filter buttons */}
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

      {/* Unified table */}
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
                const isMapped = entry.externalCode !== undefined && !!manualMap[entry.externalCode]

                return (
                  <TableRow key={entry.key} className={applied ? 'bg-green-50/30' : undefined}>
                    {/* 체크박스 컬럼 */}
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
                    {/* 옵션명 셀 — 매핑됨이면 수정/취소 인라인 버튼 */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{entry.optionName}</span>
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
                    {/* 동작 컬럼 — 미매핑 file-only만 [상품 선택] 노출 */}
                    <TableCell>
                      {canEdit && entry.status === 'file-only' && entry.externalCode && (
                        <div className="flex items-center gap-1">
                          {(entry.suggestions?.length ?? 0) > 0 && (
                            <Select
                              value={manualMap[entry.externalCode] ?? ''}
                              onValueChange={(v) => {
                                const code = entry.externalCode!
                                setManualMap((m) => ({ ...m, [code]: v }))
                                const suggestion = entry.suggestions?.find((s) => s.optionId === v)
                                if (suggestion) {
                                  setManualMeta((m) => ({
                                    ...m,
                                    [code]: {
                                      productName: suggestion.productName,
                                      optionName: suggestion.optionName,
                                    },
                                  }))
                                  setSelected((s) => {
                                    const next = new Set(s)
                                    next.add(`file-${code}`)
                                    return next
                                  })
                                }
                              }}
                              disabled={(entry.suggestions?.length ?? 0) === 0}
                            >
                              <SelectTrigger className="h-7 w-32 text-xs">
                                <SelectValue placeholder="후보 선택" />
                              </SelectTrigger>
                              <SelectContent>
                                {(entry.suggestions ?? []).map((s) => (
                                  <SelectItem key={s.optionId} value={s.optionId}>
                                    {s.productName} / {s.optionName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
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

      <OptionPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={handlePicked}
        excludeOptionIds={excludeOptionIds}
        mode="two-step"
        contextLabel="매칭 대상 (파일)"
        contextValue={pickerContext}
      />
    </div>
  )
}
