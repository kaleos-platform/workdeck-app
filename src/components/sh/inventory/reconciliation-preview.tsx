'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import {
  OptionPickerDialog,
  type PickedOption,
} from '@/components/sh/products/listings/option-picker-dialog'

// Match entry types (mirror of server)
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
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED'
  totalItems: number
  matchedItems: number
  adjustedItems: number
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
}

const STATUS_FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'matched-diff', label: '차이있음' },
  { value: 'matched-equal', label: '일치' },
  { value: 'file-only', label: '미매칭' },
  { value: 'system-only', label: '파일 누락' },
] as const

function statusBadge(status: string) {
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

export function ReconciliationPreview({ reconciliationId, onClose, onConfirmed }: Props) {
  const [recon, setRecon] = useState<Reconciliation | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'matched-diff' | 'matched-equal' | 'file-only' | 'system-only'
  >('all')
  // selected matched-diff optionIds (default: all)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // manual mappings (externalCode -> optionId) chosen by user
  const [manualMap, setManualMap] = useState<Record<string, string>>({})
  // applied manual map (adjust these too)
  const [applyMapped, setApplyMapped] = useState<Record<string, boolean>>({})

  // 옵션 선택 다이얼로그 (상품 → 옵션 2단계)
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
      const diffIds = (r.matchResults ?? [])
        .filter(
          (e): e is Extract<MatchEntry, { status: 'matched-diff' }> => e.status === 'matched-diff'
        )
        .map((e) => e.optionId)
      setSelected(new Set(diffIds))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [reconciliationId])

  useEffect(() => {
    load()
  }, [load])

  const entries = recon?.matchResults ?? []
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

  // Build unified entries
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
          fileQty: null,
          delta: null,
          optionId: e.optionId,
          row: e.row,
        })
      }
    }

    for (const e of fileOnlyEntries) {
      result.push({
        key: `file-${e.row.externalCode}`,
        status: 'file-only',
        productName: e.row.externalName ?? e.row.externalCode,
        optionName: e.row.externalOptionName ?? '-',
        systemQty: null,
        fileQty: e.row.quantity,
        delta: null,
        externalCode: e.row.externalCode,
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
  }, [diffEntries, equalEntries, fileOnlyEntries, systemOnlyEntries])

  const filteredEntries = useMemo(
    () =>
      statusFilter === 'all'
        ? unifiedEntries
        : unifiedEntries.filter((e) => e.status === statusFilter),
    [unifiedEntries, statusFilter]
  )

  function toggle(optionId: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(optionId)) next.delete(optionId)
      else next.add(optionId)
      return next
    })
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
    setManualMap((m) => ({ ...m, [pickerExternalCode]: picked.optionId }))
    setApplyMapped((m) => ({ ...m, [pickerExternalCode]: true }))
    setPickerOpen(false)
    toast.success(`${picked.productName} / ${picked.optionName} 매칭됨`)
  }

  // 이미 매칭된 optionId는 picker에서 제외
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

  async function handleConfirm() {
    if (!recon) return
    setSubmitting(true)
    try {
      const manualMappings = Object.entries(manualMap)
        .filter(([, v]) => !!v)
        .map(([externalCode, optionId]) => ({ externalCode, optionId }))

      const selectedOptionIds = [...selected]
      // file-only items where user checked "apply"
      for (const [externalCode, optionId] of Object.entries(manualMap)) {
        if (optionId && applyMapped[externalCode]) {
          selectedOptionIds.push(optionId)
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
      if (!res.ok) throw new Error(data.message ?? '확정 실패')
      toast.success(`${data.adjustedCount}건 조정 완료`)
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

  const isPending = recon.status === 'PENDING'

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">{recon.fileName}</h2>
          <p className="text-sm text-muted-foreground">
            {recon.location.name} · 기준일 {new Date(recon.snapshotDate).toISOString().slice(0, 10)}{' '}
            · <Badge variant="outline">{recon.status}</Badge>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            총 {recon.totalItems}건 · 자동매칭 {recon.matchedItems}건 · 조정 {recon.adjustedItems}건
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          닫기
        </Button>
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
                <TableHead className="w-24">상태</TableHead>
                <TableHead>상품명</TableHead>
                <TableHead>옵션명</TableHead>
                <TableHead className="w-20 text-right">시스템</TableHead>
                <TableHead className="w-20 text-right">파일</TableHead>
                <TableHead className="w-20 text-right">차이</TableHead>
                <TableHead className="w-60">동작</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((entry) => (
                <TableRow key={entry.key}>
                  <TableCell>{statusBadge(entry.status)}</TableCell>
                  <TableCell className="font-medium">{entry.productName}</TableCell>
                  <TableCell className="text-muted-foreground">{entry.optionName}</TableCell>
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
                    {entry.status === 'matched-diff' && entry.optionId && (
                      <Checkbox
                        checked={selected.has(entry.optionId)}
                        onCheckedChange={() => toggle(entry.optionId!)}
                        disabled={!isPending}
                      />
                    )}
                    {entry.status === 'file-only' && entry.externalCode && (
                      <div className="flex items-center gap-1.5">
                        <Select
                          value={manualMap[entry.externalCode] ?? ''}
                          onValueChange={(v) =>
                            setManualMap((m) => ({
                              ...m,
                              [entry.externalCode!]: v,
                            }))
                          }
                          disabled={!isPending || (entry.suggestions?.length ?? 0) === 0}
                        >
                          <SelectTrigger className="h-7 w-36 text-xs">
                            <SelectValue
                              placeholder={
                                (entry.suggestions?.length ?? 0) === 0 ? '후보 없음' : '후보 선택'
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {(entry.suggestions ?? []).map((s) => (
                              <SelectItem key={s.optionId} value={s.optionId}>
                                {s.productName} / {s.optionName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Checkbox
                          checked={!!applyMapped[entry.externalCode]}
                          disabled={!isPending || !manualMap[entry.externalCode]}
                          onCheckedChange={(v) =>
                            setApplyMapped((m) => ({
                              ...m,
                              [entry.externalCode!]: v === true,
                            }))
                          }
                        />
                        {isPending && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => openPicker(entry)}
                          >
                            <Search className="mr-1 h-3 w-3" />
                            상품 선택
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {isPending && (
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={handleCancel} disabled={submitting}>
            대조 취소
          </Button>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            적용 ({selected.size}건 조정)
          </Button>
        </div>
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
