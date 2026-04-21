'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type OptionRow = {
  id: string
  name: string
  sku: string | null
  costPrice: number | null
  retailPrice: number | null
  sizeLabel: string | null
  setSizeLabel: string | null
  totalStock: number
}

type OptionDraft = {
  name: string
  sku: string
  costPrice: string
  retailPrice: string
  sizeLabel: string
  setSizeLabel: string
}

type NewOptionDraft = OptionDraft

type Props = {
  productId: string
  onChanged?: () => void
}

function rowToString(value: number | null): string {
  return value != null ? String(value) : ''
}

export function ProductOptionsTable({ productId, onChanged }: Props) {
  const [options, setOptions] = useState<OptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, OptionDraft>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [newRow, setNewRow] = useState<NewOptionDraft | null>(null)
  const [savingNew, setSavingNew] = useState(false)

  const loadOptions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/products/${productId}/options`)
      if (!res.ok) return
      const data = await res.json()
      const opts: OptionRow[] = data.options ?? data ?? []
      setOptions(opts)
      const d: Record<string, OptionDraft> = {}
      opts.forEach((o) => {
        d[o.id] = {
          name: o.name,
          sku: o.sku ?? '',
          costPrice: rowToString(o.costPrice),
          retailPrice: rowToString(o.retailPrice),
          sizeLabel: o.sizeLabel ?? '',
          setSizeLabel: o.setSizeLabel ?? '',
        }
      })
      setDrafts(d)
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    void loadOptions()
  }, [loadOptions])

  function updateDraft(id: string, field: keyof OptionDraft, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }))
  }

  async function saveOption(optionId: string) {
    const draft = drafts[optionId]
    const original = options.find((o) => o.id === optionId)
    if (!draft || !original) return

    if (!draft.name.trim()) {
      toast.error('옵션명을 입력해 주세요')
      return
    }

    setSaving(optionId)
    try {
      const res = await fetch(`/api/sh/products/${productId}/options/${optionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          sku: draft.sku.trim() || null,
          costPrice: draft.costPrice ? parseFloat(draft.costPrice) : null,
          retailPrice: draft.retailPrice ? parseFloat(draft.retailPrice) : null,
          sizeLabel: draft.sizeLabel.trim() || null,
          setSizeLabel: draft.setSizeLabel.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success('옵션이 저장되었습니다')
      await loadOptions()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(null)
    }
  }

  async function deleteOption(optionId: string) {
    if (!confirm('이 옵션을 삭제하시겠습니까? 재고 기록도 함께 삭제됩니다.')) return
    try {
      const res = await fetch(`/api/sh/products/${productId}/options/${optionId}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('옵션이 삭제되었습니다')
      await loadOptions()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  async function saveNewOption() {
    if (!newRow || !newRow.name.trim()) {
      toast.error('옵션명을 입력해 주세요')
      return
    }
    setSavingNew(true)
    try {
      const res = await fetch(`/api/sh/products/${productId}/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRow.name.trim(),
          sku: newRow.sku.trim() || undefined,
          costPrice: newRow.costPrice ? parseFloat(newRow.costPrice) : undefined,
          retailPrice: newRow.retailPrice ? parseFloat(newRow.retailPrice) : undefined,
          sizeLabel: newRow.sizeLabel.trim() || undefined,
          setSizeLabel: newRow.setSizeLabel.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '추가 실패')
      toast.success('옵션이 추가되었습니다')
      setNewRow(null)
      await loadOptions()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '추가 실패')
    } finally {
      setSavingNew(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">옵션 ({options.length})</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setNewRow({
              name: '',
              sku: '',
              costPrice: '',
              retailPrice: '',
              sizeLabel: '',
              setSizeLabel: '',
            })
          }
          disabled={!!newRow}
        >
          <Plus className="mr-1 h-3 w-3" />
          옵션 추가
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[120px]">옵션명</TableHead>
              <TableHead className="min-w-[100px]">SKU</TableHead>
              <TableHead className="min-w-[90px]">원가</TableHead>
              <TableHead className="min-w-[90px]">소비자가</TableHead>
              <TableHead className="min-w-[90px]">사이즈</TableHead>
              <TableHead className="min-w-[90px]">세트 사이즈</TableHead>
              <TableHead className="w-16 text-right">재고</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {options.length === 0 && !newRow ? (
              <TableRow>
                <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                  등록된 옵션이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              options.map((opt) => {
                const draft = drafts[opt.id] ?? {
                  name: opt.name,
                  sku: opt.sku ?? '',
                  costPrice: rowToString(opt.costPrice),
                  retailPrice: rowToString(opt.retailPrice),
                  sizeLabel: opt.sizeLabel ?? '',
                  setSizeLabel: opt.setSizeLabel ?? '',
                }
                const isSaving = saving === opt.id
                return (
                  <TableRow key={opt.id}>
                    <TableCell>
                      <Input
                        value={draft.name}
                        onChange={(e) => updateDraft(opt.id, 'name', e.target.value)}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={draft.sku}
                        placeholder="(없음)"
                        onChange={(e) => updateDraft(opt.id, 'sku', e.target.value)}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        value={draft.costPrice}
                        placeholder="0"
                        onChange={(e) => updateDraft(opt.id, 'costPrice', e.target.value)}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        value={draft.retailPrice}
                        placeholder="0"
                        onChange={(e) => updateDraft(opt.id, 'retailPrice', e.target.value)}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={draft.sizeLabel}
                        placeholder="예: S/M/L"
                        onChange={(e) => updateDraft(opt.id, 'sizeLabel', e.target.value)}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={draft.setSizeLabel}
                        placeholder="예: 2P"
                        onChange={(e) => updateDraft(opt.id, 'setSizeLabel', e.target.value)}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {opt.totalStock.toLocaleString('ko-KR')}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={isSaving}
                          onClick={() => saveOption(opt.id)}
                        >
                          저장
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => deleteOption(opt.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}

            {/* 신규 옵션 입력 행 */}
            {newRow && (
              <TableRow>
                <TableCell>
                  <Input
                    value={newRow.name}
                    onChange={(e) => setNewRow({ ...newRow, name: e.target.value })}
                    placeholder="옵션명 *"
                    autoFocus
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={newRow.sku}
                    onChange={(e) => setNewRow({ ...newRow, sku: e.target.value })}
                    placeholder="SKU"
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min="0"
                    value={newRow.costPrice}
                    onChange={(e) => setNewRow({ ...newRow, costPrice: e.target.value })}
                    placeholder="0"
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min="0"
                    value={newRow.retailPrice}
                    onChange={(e) => setNewRow({ ...newRow, retailPrice: e.target.value })}
                    placeholder="0"
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={newRow.sizeLabel}
                    onChange={(e) => setNewRow({ ...newRow, sizeLabel: e.target.value })}
                    placeholder="예: S/M/L"
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={newRow.setSizeLabel}
                    onChange={(e) => setNewRow({ ...newRow, setSizeLabel: e.target.value })}
                    placeholder="예: 2P"
                    className="h-8"
                  />
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">-</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={savingNew}
                      onClick={saveNewOption}
                    >
                      추가
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setNewRow(null)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
