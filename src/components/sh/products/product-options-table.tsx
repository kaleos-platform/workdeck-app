'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  generateOptionSku,
  normalizeOptionAttributes,
  type AttrCodeSpec,
} from '@/lib/sh/option-code'

type OptionRow = {
  id: string
  name: string
  sku: string | null
  costPrice: number | string | null
  retailPrice: number | string | null
  attributeValues: Record<string, string> | null
  totalStock: number
}

type ProductResp = {
  id: string
  code: string | null
  optionAttributes: unknown
  options: OptionRow[]
}

type Props = {
  productId: string
  onChanged?: () => void
}

/** 행별 draft (sku/원가/소비자가 inline 편집) */
type OptionDraft = {
  sku: string
  costPrice: string
  retailPrice: string
}

function rowToString(v: number | string | null): string {
  return v != null ? String(v) : ''
}

export function ProductOptionsTable({ productId, onChanged }: Props) {
  const [product, setProduct] = useState<ProductResp | null>(null)
  const [options, setOptions] = useState<OptionRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, OptionDraft>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkCost, setBulkCost] = useState('')
  const [bulkRetail, setBulkRetail] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/products/${productId}`)
      if (!res.ok) return
      const json = await res.json()
      const prod: ProductResp = json.product ?? json
      // 옵션 기본 로드 (totalStock 별도 조회 필요 시 options API 사용)
      const optsRes = await fetch(`/api/sh/products/${productId}/options`)
      const optsJson = await optsRes.json().catch(() => ({}))
      const opts: OptionRow[] = optsJson.options ?? optsJson ?? prod.options ?? []
      setProduct(prod)
      setOptions(opts)
      const d: Record<string, OptionDraft> = {}
      opts.forEach((o) => {
        d[o.id] = {
          sku: o.sku ?? '',
          costPrice: rowToString(o.costPrice),
          retailPrice: rowToString(o.retailPrice),
        }
      })
      setDrafts(d)
      setSelected(new Set())
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    void load()
  }, [load])

  // 속성 정의 (동적 컬럼 렌더)
  const attributes = useMemo(
    () => (product ? normalizeOptionAttributes(product.optionAttributes) : []),
    [product]
  )

  // sku 중복 Map — 각 sku가 몇 번 쓰이는지
  const skuCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of options) {
      const key = (drafts[o.id]?.sku ?? o.sku ?? '').trim()
      if (!key) continue
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return m
  }, [options, drafts])

  function updateDraft(id: string, field: keyof OptionDraft, value: string) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  async function saveOption(optionId: string) {
    const draft = drafts[optionId]
    if (!draft) return
    setSavingId(optionId)
    try {
      const res = await fetch(`/api/sh/products/${productId}/options/${optionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: draft.sku.trim() || null,
          costPrice: draft.costPrice ? parseFloat(draft.costPrice) : null,
          retailPrice: draft.retailPrice ? parseFloat(draft.retailPrice) : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success('옵션이 저장되었습니다')
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSavingId(null)
    }
  }

  async function deleteOption(optionId: string) {
    if (!confirm('이 옵션을 삭제하시겠습니까? 재고 기록도 함께 삭제됩니다.')) return
    try {
      const res = await fetch(`/api/sh/products/${productId}/options/${optionId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d?.message ?? '삭제 실패')
      }
      toast.success('옵션이 삭제되었습니다')
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(options.map((o) => o.id)) : new Set())
    },
    [options]
  )

  const toggleOne = useCallback((id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  async function applyBulkEdit() {
    if (selected.size === 0) return
    const costVal = bulkCost.trim() !== '' ? parseFloat(bulkCost) : null
    const retailVal = bulkRetail.trim() !== '' ? parseFloat(bulkRetail) : null
    if (costVal === null && retailVal === null) {
      toast.error('원가 또는 소비자가 중 하나 이상 입력하세요')
      return
    }
    setBulkSaving(true)
    try {
      await Promise.all(
        Array.from(selected).map(async (id) => {
          const body: Record<string, number> = {}
          if (costVal !== null) body.costPrice = costVal
          if (retailVal !== null) body.retailPrice = retailVal
          const res = await fetch(`/api/sh/products/${productId}/options/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!res.ok) {
            const d = await res.json().catch(() => ({}))
            throw new Error(d?.message ?? '일괄 편집 실패')
          }
        })
      )
      toast.success(`${selected.size}개 옵션이 업데이트되었습니다`)
      setBulkOpen(false)
      setBulkCost('')
      setBulkRetail('')
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '일괄 편집 실패')
    } finally {
      setBulkSaving(false)
    }
  }

  async function regenerateSku() {
    if (selected.size === 0 || !product) return
    const productCode = product.code?.trim() || null
    setBulkSaving(true)
    try {
      await Promise.all(
        Array.from(selected).map(async (id) => {
          const o = options.find((x) => x.id === id)
          if (!o) return
          const attrValues = o.attributeValues ?? {}
          const specs: AttrCodeSpec[] = attributes.map((attr, attrIdx) => {
            const val = attrValues[attr.name] ?? ''
            const match = attr.values.find((v) => v.value === val)
            const code = match?.code?.trim() ?? ''
            const maxLen = Math.max(0, ...attr.values.map((v) => v.code?.length ?? 0))
            return { attrIdx, code, maxLen }
          })
          const newSku = generateOptionSku({ productCode, attributeCodes: specs })
          const res = await fetch(`/api/sh/products/${productId}/options/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sku: newSku || null }),
          })
          if (!res.ok) {
            const d = await res.json().catch(() => ({}))
            throw new Error(d?.message ?? 'SKU 재생성 실패')
          }
        })
      )
      toast.success(`${selected.size}개 옵션의 관리코드가 재생성되었습니다`)
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'SKU 재생성 실패')
    } finally {
      setBulkSaving(false)
    }
  }

  async function bulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`선택한 ${selected.size}개 옵션을 삭제하시겠습니까? 재고 기록도 함께 삭제됩니다.`))
      return
    setBulkSaving(true)
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch(`/api/sh/products/${productId}/options/${id}`, { method: 'DELETE' })
        )
      )
      toast.success(`${selected.size}개 옵션 삭제됨`)
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    } finally {
      setBulkSaving(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  const allChecked = options.length > 0 && selected.size === options.length
  const attrNames = attributes.map((a) => a.name)
  const colSpan = 1 + attrNames.length + 5 // 체크박스 + 속성컬럼 + sku/원가/소비자가/재고/액션

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">옵션 ({options.length})</h3>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-xs">
            <span className="font-medium">{selected.size}개 선택</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setBulkOpen(true)}
              disabled={bulkSaving}
            >
              일괄 편집
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={regenerateSku}
              disabled={bulkSaving}
            >
              <Sparkles className="mr-1 h-3 w-3" />
              관리코드 재생성
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs text-destructive"
              onClick={bulkDelete}
              disabled={bulkSaving}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              삭제
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
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(v) => toggleAll(v === true)}
                  aria-label="전체 선택"
                />
              </TableHead>
              {attrNames.map((n) => (
                <TableHead key={n} className="min-w-[80px]">
                  {n}
                </TableHead>
              ))}
              {attrNames.length === 0 && <TableHead className="min-w-[120px]">옵션명</TableHead>}
              <TableHead className="min-w-[140px]">관리코드 (SKU)</TableHead>
              <TableHead className="min-w-[90px]">원가</TableHead>
              <TableHead className="min-w-[90px]">소비자가</TableHead>
              <TableHead className="w-16 text-right">재고</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {options.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-6 text-center text-muted-foreground">
                  등록된 옵션이 없습니다. 위에서 속성을 정의하면 자동으로 옵션이 생성됩니다.
                </TableCell>
              </TableRow>
            ) : (
              options.map((opt) => {
                const draft = drafts[opt.id] ?? {
                  sku: opt.sku ?? '',
                  costPrice: rowToString(opt.costPrice),
                  retailPrice: rowToString(opt.retailPrice),
                }
                const isSaving = savingId === opt.id
                const skuKey = draft.sku.trim()
                const isDuplicate = skuKey && (skuCount.get(skuKey) ?? 0) > 1
                return (
                  <TableRow
                    key={opt.id}
                    data-selected={selected.has(opt.id) || undefined}
                    className="data-[selected=true]:bg-muted/50"
                  >
                    <TableCell>
                      <Checkbox
                        checked={selected.has(opt.id)}
                        onCheckedChange={(v) => toggleOne(opt.id, v === true)}
                        aria-label={`${opt.name} 선택`}
                      />
                    </TableCell>
                    {attrNames.length > 0 ? (
                      attrNames.map((n) => (
                        <TableCell key={n} className="py-2 text-sm">
                          {(opt.attributeValues ?? {})[n] ?? '-'}
                        </TableCell>
                      ))
                    ) : (
                      <TableCell className="py-2 text-sm font-medium">{opt.name}</TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={draft.sku}
                          placeholder="(자동)"
                          onChange={(e) => updateDraft(opt.id, 'sku', e.target.value)}
                          className="h-8"
                        />
                        {isDuplicate && (
                          <Badge
                            variant="outline"
                            className="gap-1 border-amber-500/50 bg-amber-50 text-[10px] text-amber-700 dark:bg-amber-950/30"
                            title="다른 옵션과 관리코드가 중복됩니다"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            중복
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        value={draft.costPrice}
                        onChange={(e) => updateDraft(opt.id, 'costPrice', e.target.value)}
                        placeholder="0"
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        value={draft.retailPrice}
                        onChange={(e) => updateDraft(opt.id, 'retailPrice', e.target.value)}
                        placeholder="0"
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(opt.totalStock ?? 0).toLocaleString('ko-KR')}
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
                          {isSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
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
          </TableBody>
        </Table>
      </div>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{selected.size}개 옵션 일괄 편집</DialogTitle>
            <DialogDescription>
              비워두는 필드는 변경되지 않습니다. 속성 값은 속성 편집 섹션에서만 변경할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-cost">원가</Label>
              <Input
                id="bulk-cost"
                type="number"
                min="0"
                value={bulkCost}
                onChange={(e) => setBulkCost(e.target.value)}
                placeholder="변경 없으면 비워두세요"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-retail">소비자가</Label>
              <Input
                id="bulk-retail"
                type="number"
                min="0"
                value={bulkRetail}
                onChange={(e) => setBulkRetail(e.target.value)}
                placeholder="변경 없으면 비워두세요"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkSaving}>
              취소
            </Button>
            <Button onClick={applyBulkEdit} disabled={bulkSaving}>
              {bulkSaving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              적용
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
