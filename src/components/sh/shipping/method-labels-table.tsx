'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
}

type Brand = { id: string; name: string }

const ALL = 'all'
const NO_BRAND = 'none'

export function MethodLabelsTable({ methodId }: { methodId: string }) {
  const [method, setMethod] = useState<MethodInfo | null>(null)
  const [rows, setRows] = useState<LabelRow[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [brandFilter, setBrandFilter] = useState<string>(ALL)
  const [total, setTotal] = useState(0)
  const [editing, setEditing] = useState<LabelRow | null>(null)

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
      setRows(data.data ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      console.error(err)
      toast.error('라벨 데이터를 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [methodId, debouncedSearch, brandFilter])

  useEffect(() => {
    load()
  }, [load])

  // method의 formatConfig에 실제 사용되는 field 만 편집 가능 필드로 제공
  const availableFields = useMemo<DelFieldMapping[]>(() => {
    if (!method) return []
    const set = new Set<DelFieldMapping>()
    for (const col of method.formatConfig ?? []) {
      if (col.field) set.add(col.field)
    }
    return Array.from(set)
  }, [method])

  const overriddenCount = useMemo(
    () => rows.filter((r) => Object.keys(r.overrides).length > 0).length,
    [rows]
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{method?.name ?? '배송 방식'}</h1>
        <p className="text-sm text-muted-foreground">
          옵션별로 배송 파일에 쓰이는 값을 지정할 수 있습니다 · 오버라이드 {overriddenCount}건 /
          노출 {rows.length}건 (전체 옵션 {total}건)
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
      </div>

      {availableFields.length === 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          이 배송 방식의 컬럼 매핑이 비어있어 오버라이드할 필드가 없습니다. 먼저 배송 방식 관리에서
          컬럼 매핑을 설정해 주세요.
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>상품</TableHead>
              <TableHead>옵션</TableHead>
              <TableHead>브랜드</TableHead>
              <TableHead>관리코드(SKU)</TableHead>
              <TableHead>오버라이드</TableHead>
              <TableHead className="w-24 text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  표시할 옵션이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const ovKeys = Object.keys(row.overrides) as DelFieldMapping[]
                return (
                  <TableRow key={row.optionId}>
                    <TableCell className="font-medium">{row.productName}</TableCell>
                    <TableCell>{row.optionName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.brandName ?? '-'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.sku ?? '-'}
                    </TableCell>
                    <TableCell>
                      {ovKeys.length === 0 ? (
                        <span className="text-xs text-muted-foreground">없음</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {ovKeys.map((k) => (
                            <Badge key={k} variant="secondary" className="text-[10px]">
                              {FIELD_LABELS[k]}: {row.overrides[k]}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={availableFields.length === 0}
                        onClick={() => setEditing(row)}
                      >
                        <Pencil className="mr-1 h-3 w-3" />
                        편집
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {editing && method && (
        <EditLabelDialog
          open={!!editing}
          onOpenChange={(v) => !v && setEditing(null)}
          methodId={methodId}
          row={editing}
          availableFields={availableFields}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

type EditProps = {
  open: boolean
  onOpenChange: (v: boolean) => void
  methodId: string
  row: LabelRow
  availableFields: DelFieldMapping[]
  onSaved: () => void
}

function EditLabelDialog({
  open,
  onOpenChange,
  methodId,
  row,
  availableFields,
  onSaved,
}: EditProps) {
  const [values, setValues] = useState<Partial<Record<DelFieldMapping, string>>>({})
  const [enabled, setEnabled] = useState<Set<DelFieldMapping>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setValues({ ...row.overrides })
    setEnabled(new Set(Object.keys(row.overrides) as DelFieldMapping[]))
  }, [open, row])

  function toggleField(f: DelFieldMapping, checked: boolean) {
    setEnabled((prev) => {
      const next = new Set(prev)
      if (checked) next.add(f)
      else next.delete(f)
      return next
    })
  }

  function setValue(f: DelFieldMapping, v: string) {
    setValues((prev) => ({ ...prev, [f]: v }))
  }

  async function handleSave() {
    // enabled 필드 중 값이 비어있지 않은 것만 overrides에 포함
    const overrides: Partial<Record<DelFieldMapping, string>> = {}
    for (const f of enabled) {
      const v = (values[f] ?? '').trim()
      if (v) overrides[f] = v
    }
    setSaving(true)
    try {
      const res = await fetch(
        `/api/sh/shipping/shipping-methods/${methodId}/labels/${row.optionId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overrides }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '저장 실패')
      }
      toast.success('라벨을 저장했습니다')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    if (!confirm('이 옵션의 모든 오버라이드를 삭제하시겠습니까?')) return
    setSaving(true)
    try {
      const res = await fetch(
        `/api/sh/shipping/shipping-methods/${methodId}/labels/${row.optionId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error('삭제 실패')
      toast.success('오버라이드를 삭제했습니다')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>라벨 편집</DialogTitle>
          <DialogDescription>
            <span className="block">
              {row.productName} — {row.optionName}
            </span>
            <span className="mt-0.5 block text-xs">
              체크된 필드만 배송 파일 생성 시 지정 값으로 사용됩니다.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {availableFields.map((f) => {
            const on = enabled.has(f)
            return (
              <div key={f} className="space-y-1.5 rounded-md border px-3 py-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox checked={on} onCheckedChange={(v) => toggleField(f, v === true)} />
                  {FIELD_LABELS[f]}
                </label>
                {on && (
                  <Input
                    value={values[f] ?? ''}
                    onChange={(e) => setValue(f, e.target.value)}
                    placeholder={`${FIELD_LABELS[f]} 오버라이드 값`}
                  />
                )}
              </div>
            )
          })}
        </div>

        <DialogFooter className="flex-row sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={saving || Object.keys(row.overrides).length === 0}
            onClick={handleClear}
          >
            <Trash2 className="mr-1 h-4 w-4" />
            전체 삭제
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              취소
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '저장 중...' : '저장'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
