'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Settings, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FIELD_LABELS,
  type DelFieldMapping,
  type DelFormatColumn,
} from '@/lib/del/format-templates'

type LabelRow = {
  productId: string
  productName: string
  productCode: string | null
  brandName: string | null
  optionId: string
  optionName: string
  sku: string | null
  overrides: Partial<Record<DelFieldMapping, string>>
  updatedAt: string | null
}

type MethodInfo = {
  id: string
  name: string
  formatConfig: DelFormatColumn[]
  labelColumns: DelFieldMapping[]
}

type Brand = { id: string; name: string }

const ALL = 'all'
const NO_BRAND = 'none'
const MAX_COLUMNS = 3

export function MethodLabelsTable({ methodId }: { methodId: string }) {
  const [method, setMethod] = useState<MethodInfo | null>(null)
  const [rows, setRows] = useState<LabelRow[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [brandFilter, setBrandFilter] = useState<string>(ALL)
  const [total, setTotal] = useState(0)

  const [columnsDialogOpen, setColumnsDialogOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  // 행별 draft — field별 현재 입력값 (서버 저장값 === draft이면 추가 PATCH 없음)
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<DelFieldMapping, string>>>>({})
  const [savingCell, setSavingCell] = useState<string | null>(null) // `${optionId}::${field}`

  // debounce 검색
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    fetch('/api/sh/brands')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBrands(d?.brands ?? []))
      .catch(() => setBrands([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
      if (brandFilter !== ALL) params.set('brandId', brandFilter)
      params.set('pageSize', '50')
      const res = await fetch(
        `/api/sh/shipping/shipping-methods/${methodId}/labels?${params.toString()}`
      )
      if (!res.ok) throw new Error('로드 실패')
      const data = await res.json()
      setMethod(data.method)
      const serverRows: LabelRow[] = data.data ?? []
      setRows(serverRows)
      setTotal(data.total ?? 0)
      // draft 초기화 — 서버 overrides를 기본값으로
      const nextDrafts: Record<string, Partial<Record<DelFieldMapping, string>>> = {}
      for (const r of serverRows) {
        nextDrafts[r.optionId] = { ...r.overrides }
      }
      setDrafts(nextDrafts)
      setSelected(new Set())
    } catch (err) {
      console.error(err)
      toast.error('배송 라벨을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [methodId, debouncedSearch, brandFilter])

  useEffect(() => {
    load()
  }, [load])

  // method.formatConfig에서 실제 매핑된 field만 "선택 가능" 후보로 노출.
  const availableFields = useMemo<DelFieldMapping[]>(() => {
    if (!method) return []
    const set = new Set<DelFieldMapping>()
    for (const col of method.formatConfig ?? []) {
      if (col.field) set.add(col.field)
    }
    return Array.from(set)
  }, [method])

  const labelColumns = method?.labelColumns ?? []
  const hasLabelColumns = labelColumns.length > 0

  const overriddenCount = useMemo(
    () => rows.filter((r) => Object.keys(r.overrides).length > 0).length,
    [rows]
  )

  const rowsById = useMemo(() => {
    const m = new Map<string, LabelRow>()
    for (const r of rows) m.set(r.optionId, r)
    return m
  }, [rows])

  async function persistRowOverrides(
    optionId: string,
    next: Partial<Record<DelFieldMapping, string>>
  ) {
    // 빈 문자열 키는 제거하고 저장
    const cleaned: Partial<Record<DelFieldMapping, string>> = {}
    for (const k of Object.keys(next) as DelFieldMapping[]) {
      const v = (next[k] ?? '').trim()
      if (v) cleaned[k] = v
    }
    const res = await fetch(`/api/sh/shipping/shipping-methods/${methodId}/labels/${optionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides: cleaned }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data?.message ?? '저장 실패')
    }
    return cleaned
  }

  async function handleCellBlur(row: LabelRow, field: DelFieldMapping) {
    const draft = drafts[row.optionId] ?? {}
    const nextVal = (draft[field] ?? '').trim()
    const prevVal = (row.overrides[field] ?? '').trim()
    if (nextVal === prevVal) return

    const key = `${row.optionId}::${field}`
    setSavingCell(key)
    try {
      const nextOverrides = { ...row.overrides, [field]: nextVal }
      if (!nextVal) delete nextOverrides[field]
      const saved = await persistRowOverrides(row.optionId, nextOverrides)
      // row + draft 동기화
      setRows((prev) =>
        prev.map((r) => (r.optionId === row.optionId ? { ...r, overrides: saved } : r))
      )
      setDrafts((prev) => ({ ...prev, [row.optionId]: { ...saved } }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
      // 실패 시 draft를 원상 복구
      setDrafts((prev) => ({
        ...prev,
        [row.optionId]: { ...row.overrides },
      }))
    } finally {
      setSavingCell(null)
    }
  }

  function updateDraft(optionId: string, field: DelFieldMapping, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [optionId]: { ...(prev[optionId] ?? {}), [field]: value },
    }))
  }

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(rows.map((r) => r.optionId)) : new Set())
    },
    [rows]
  )

  const toggleOne = useCallback((optionId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(optionId)
      else next.delete(optionId)
      return next
    })
  }, [])

  async function bulkClear() {
    if (selected.size === 0) return
    if (!confirm(`선택한 ${selected.size}개 옵션의 배송 라벨을 모두 삭제하시겠습니까?`)) return
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch(`/api/sh/shipping/shipping-methods/${methodId}/labels/${id}`, {
            method: 'DELETE',
          })
        )
      )
      toast.success(`${selected.size}개 옵션의 배송 라벨을 삭제했습니다`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {method?.name ?? <span className="text-muted-foreground">불러오는 중...</span>}
        </h1>
        <p className="text-sm text-muted-foreground">
          {method ? (
            <>
              이 배송 방식에서 덮어쓸 배송 라벨 컬럼을 지정합니다 · 배송 라벨 {overriddenCount}건 /
              노출 {rows.length}건 (전체 옵션 {total}건)
            </>
          ) : (
            '이 배송 방식에서 덮어쓸 배송 라벨 컬럼을 지정합니다'
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="상품명 · 옵션명 · 관리코드 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
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
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setColumnsDialogOpen(true)}
            disabled={!method}
          >
            <Settings className="mr-1 h-3.5 w-3.5" />
            배송 라벨 컬럼 ({labelColumns.length}/{MAX_COLUMNS})
          </Button>
        </div>
      </div>

      {method && !hasLabelColumns && (
        <div className="rounded-md border border-dashed bg-muted/30 px-6 py-8 text-center">
          <p className="text-sm font-semibold">배송 라벨 컬럼이 설정되지 않았습니다</p>
          <p className="mt-1 text-xs text-muted-foreground">
            먼저 배송 파일에서 덮어쓸 컬럼을 선택하세요 (최대 {MAX_COLUMNS}개).
          </p>
          <Button
            size="sm"
            className="mt-3"
            onClick={() => setColumnsDialogOpen(true)}
            disabled={availableFields.length === 0}
          >
            배송 라벨 컬럼 설정
          </Button>
          {availableFields.length === 0 && (
            <p className="mt-2 text-[11px] text-amber-700">
              이 배송 방식의 컬럼 매핑이 비어있어 선택할 필드가 없습니다. 먼저 컬럼 매핑을
              설정해주세요.
            </p>
          )}
        </div>
      )}

      {selected.size > 0 && hasLabelColumns && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-xs">
          <span className="font-medium">{selected.size}개 선택</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setBulkOpen(true)}
          >
            일괄 편집
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-destructive"
            onClick={bulkClear}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            배송 라벨 삭제
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setSelected(new Set())}
            aria-label="선택 해제"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      <div
        className={`overflow-x-auto rounded-md border ${!hasLabelColumns ? 'pointer-events-none opacity-50' : ''}`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={rows.length > 0 && selected.size === rows.length}
                  onCheckedChange={(v) => toggleAll(v === true)}
                  aria-label="전체 선택"
                  disabled={!hasLabelColumns}
                />
              </TableHead>
              <TableHead>상품명</TableHead>
              <TableHead>옵션명</TableHead>
              <TableHead>관리코드(SKU)</TableHead>
              {labelColumns.map((f) => (
                <TableHead key={f} className="min-w-[160px]">
                  {FIELD_LABELS[f]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={4 + labelColumns.length}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4 + labelColumns.length}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  표시할 옵션이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const draft = drafts[row.optionId] ?? {}
                return (
                  <TableRow
                    key={row.optionId}
                    data-selected={selected.has(row.optionId) || undefined}
                    className="data-[selected=true]:bg-muted/40"
                  >
                    <TableCell>
                      <Checkbox
                        checked={selected.has(row.optionId)}
                        onCheckedChange={(v) => toggleOne(row.optionId, v === true)}
                        aria-label={`${row.optionName} 선택`}
                        disabled={!hasLabelColumns}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{row.productName}</TableCell>
                    <TableCell>{row.optionName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.sku ?? '-'}
                    </TableCell>
                    {labelColumns.map((f) => {
                      const cellKey = `${row.optionId}::${f}`
                      return (
                        <TableCell key={f}>
                          <Input
                            value={draft[f] ?? ''}
                            onChange={(e) => updateDraft(row.optionId, f, e.target.value)}
                            onBlur={() => handleCellBlur(row, f)}
                            placeholder={FIELD_LABELS[f]}
                            className="h-8"
                            disabled={savingCell === cellKey}
                          />
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {method && (
        <LabelColumnsDialog
          open={columnsDialogOpen}
          onOpenChange={setColumnsDialogOpen}
          methodId={methodId}
          availableFields={availableFields}
          initial={labelColumns}
          onSaved={() => {
            setColumnsDialogOpen(false)
            load()
          }}
        />
      )}

      {method && hasLabelColumns && (
        <BulkEditDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          methodId={methodId}
          labelColumns={labelColumns}
          selectedIds={Array.from(selected)}
          rowsById={rowsById}
          onSaved={() => {
            setBulkOpen(false)
            load()
          }}
        />
      )}
    </div>
  )
}

// ─── Label Columns Dialog ─────────────────────────────────────────────────

type ColumnsProps = {
  open: boolean
  onOpenChange: (v: boolean) => void
  methodId: string
  availableFields: DelFieldMapping[]
  initial: DelFieldMapping[]
  onSaved: () => void
}

function LabelColumnsDialog({
  open,
  onOpenChange,
  methodId,
  availableFields,
  initial,
  onSaved,
}: ColumnsProps) {
  const [selected, setSelected] = useState<Set<DelFieldMapping>>(new Set(initial))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setSelected(new Set(initial))
  }, [open, initial])

  function toggle(f: DelFieldMapping, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) {
        if (next.size >= MAX_COLUMNS) return prev
        next.add(f)
      } else {
        next.delete(f)
      }
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      // 기존 배열 순서 유지 + 신규 선택은 뒤에 추가
      const ordered: DelFieldMapping[] = []
      for (const f of initial) if (selected.has(f)) ordered.push(f)
      for (const f of availableFields) {
        if (selected.has(f) && !ordered.includes(f)) ordered.push(f)
      }
      const res = await fetch(`/api/sh/shipping/shipping-methods/${methodId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labelColumns: ordered }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '저장 실패')
      }
      toast.success('배송 라벨 컬럼을 저장했습니다')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>배송 라벨 컬럼 선택</DialogTitle>
          <DialogDescription>
            배송 파일에서 값을 덮어쓸 컬럼을 최대 {MAX_COLUMNS}개까지 선택하세요. 컬럼 매핑이 된
            필드만 선택할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {availableFields.length === 0 ? (
            <p className="text-xs text-amber-700">컬럼 매핑이 비어있어 선택할 필드가 없습니다.</p>
          ) : (
            availableFields.map((f) => {
              const on = selected.has(f)
              const disabled = !on && selected.size >= MAX_COLUMNS
              return (
                <label
                  key={f}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-muted/40'}`}
                >
                  <Checkbox
                    checked={on}
                    onCheckedChange={(v) => toggle(f, v === true)}
                    disabled={disabled}
                  />
                  <span className="font-medium">{FIELD_LABELS[f]}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{f}</span>
                </label>
              )
            })
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          선택: {selected.size}/{MAX_COLUMNS}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Bulk Edit Dialog ─────────────────────────────────────────────────────

type BulkProps = {
  open: boolean
  onOpenChange: (v: boolean) => void
  methodId: string
  labelColumns: DelFieldMapping[]
  selectedIds: string[]
  rowsById: Map<string, LabelRow>
  onSaved: () => void
}

function BulkEditDialog({
  open,
  onOpenChange,
  methodId,
  labelColumns,
  selectedIds,
  rowsById,
  onSaved,
}: BulkProps) {
  // 각 컬럼에 대해 "미설정(빈)" / "값으로 덮어쓰기" / "비우기" 모드 지원
  const [values, setValues] = useState<Partial<Record<DelFieldMapping, string>>>({})
  const [clearFlags, setClearFlags] = useState<Set<DelFieldMapping>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setValues({})
      setClearFlags(new Set())
    }
  }, [open])

  function toggleClear(f: DelFieldMapping, checked: boolean) {
    setClearFlags((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(f)
        setValues((v) => ({ ...v, [f]: '' }))
      } else next.delete(f)
      return next
    })
  }

  async function handleApply() {
    const touchedFields: DelFieldMapping[] = []
    for (const f of labelColumns) {
      if (clearFlags.has(f) || (values[f] ?? '').trim().length > 0) touchedFields.push(f)
    }
    if (touchedFields.length === 0) {
      toast.error('변경할 컬럼이 없습니다')
      return
    }
    setSaving(true)
    try {
      await Promise.all(
        selectedIds.map(async (optionId) => {
          const row = rowsById.get(optionId)
          const existing = row?.overrides ?? {}
          const next: Partial<Record<DelFieldMapping, string>> = { ...existing }
          for (const f of touchedFields) {
            if (clearFlags.has(f)) delete next[f]
            else next[f] = (values[f] ?? '').trim()
          }
          // 빈값 제거
          for (const k of Object.keys(next) as DelFieldMapping[]) {
            if (!(next[k] ?? '').trim()) delete next[k]
          }
          const res = await fetch(
            `/api/sh/shipping/shipping-methods/${methodId}/labels/${optionId}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ overrides: next }),
            }
          )
          if (!res.ok) {
            const d = await res.json().catch(() => ({}))
            throw new Error(d?.message ?? '일괄 저장 실패')
          }
        })
      )
      toast.success(`${selectedIds.length}개 옵션에 적용했습니다`)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '일괄 저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{selectedIds.length}개 옵션 일괄 편집</DialogTitle>
          <DialogDescription>
            값이 비어있는 컬럼은 변경하지 않습니다. &quot;비우기&quot; 체크 시 해당 컬럼의 기존 값을
            제거합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {labelColumns.map((f) => {
            const cleared = clearFlags.has(f)
            return (
              <div key={f} className="space-y-1.5 rounded-md border p-3">
                <Label className="text-sm font-medium">{FIELD_LABELS[f]}</Label>
                <Input
                  value={values[f] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                  placeholder={cleared ? '(비우기 모드)' : '변경 없으면 비워두세요'}
                  disabled={cleared}
                />
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={cleared} onCheckedChange={(v) => toggleClear(f, v === true)} />
                  기존 값 비우기
                </label>
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleApply} disabled={saving}>
            {saving ? '적용 중...' : '적용'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
