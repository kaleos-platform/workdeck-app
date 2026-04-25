'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  OptionPickerDialog,
  type PickedOption,
} from '@/components/sh/products/listings/option-picker-dialog'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type CostMode = 'TOTAL' | 'BREAKDOWN'

type OptionItem = {
  optionId: string
  optionName: string
  sku: string | null
  productId: string
  productName: string
  brandName: string | null
  totalStock: number
  quantity: number
}

type CostRow = {
  /** 클라이언트 전용 key */
  _key: string
  itemName: string
  description: string
  spec: string
  quantity: string
  unitPrice: string
  note: string
}

// detail API 응답 형태
type RunDetail = {
  run: {
    id: string
    runNo: string
    orderedAt: string
    totalCost: number | null
    costMode: CostMode
    memo: string | null
    items: Array<{
      id: string
      optionId: string
      optionName: string
      sku: string | null
      productId: string
      productName: string
      brandName: string | null
      quantity: number
    }>
    costs: Array<{
      id: string
      itemName: string
      description: string | null
      spec: number | null
      quantity: number
      unitPrice: number
      amount: number
      note: string | null
      sortOrder: number
    }>
  }
}

// ─── 포맷 헬퍼 ────────────────────────────────────────────────────────────────

function fmtKRW(n: number) {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(n)
}

function calcRowAmount(row: CostRow): number {
  const spec = parseFloat(row.spec) || 1
  const qty = parseFloat(row.quantity) || 0
  const price = parseFloat(row.unitPrice) || 0
  return spec * qty * price
}

function newCostRow(): CostRow {
  return {
    _key: crypto.randomUUID(),
    itemName: '',
    description: '',
    spec: '',
    quantity: '',
    unitPrice: '',
    note: '',
  }
}

// YYYY-MM-DD
function toDateInput(iso: string) {
  return iso.slice(0, 10)
}

// ─── Props ───────────────────────────────────────────────────────────────────

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  runId?: string
  onSaved: () => void
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export function ProductionRunFormDialog({ open, onOpenChange, runId, onSaved }: Props) {
  const isEdit = !!runId

  // ── 기본 정보
  const [runNo, setRunNo] = useState('')
  const [orderedAt, setOrderedAt] = useState('')
  const [memo, setMemo] = useState('')

  // ── 옵션 목록 (productId 기준 그룹핑)
  const [optionItems, setOptionItems] = useState<OptionItem[]>([])

  // ── 원가 탭
  const [costMode, setCostMode] = useState<CostMode>('TOTAL')
  const [totalCostInput, setTotalCostInput] = useState('')
  const [costRows, setCostRows] = useState<CostRow[]>([newCostRow()])

  // ── UI 상태
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // 옵션 추가 시 어느 상품 컨텍스트에서 피커를 열었는지 (null = 새 상품 추가)
  const pickerContextRef = useRef<string | null>(null)

  // ── 폼 초기화
  function resetForm() {
    setRunNo('')
    setOrderedAt(new Date().toISOString().slice(0, 10))
    setMemo('')
    setOptionItems([])
    setCostMode('TOTAL')
    setTotalCostInput('')
    setCostRows([newCostRow()])
  }

  // ── 다이얼로그 열릴 때 처리
  useEffect(() => {
    if (!open) return

    if (isEdit && runId) {
      // 편집 모드: API에서 상세 로드
      let cancelled = false
      const load = async () => {
        setLoadingDetail(true)
        try {
          const res = await fetch(`/api/sh/production-runs/${runId}`)
          if (!res.ok) throw new Error('차수 정보를 불러올 수 없습니다')
          const data: RunDetail = await res.json()
          if (cancelled) return
          const r = data.run

          setRunNo(r.runNo)
          setOrderedAt(toDateInput(r.orderedAt))
          setMemo(r.memo ?? '')

          // items → OptionItem[]
          setOptionItems(
            r.items.map((it) => ({
              optionId: it.optionId,
              optionName: it.optionName,
              sku: it.sku,
              productId: it.productId,
              productName: it.productName,
              brandName: it.brandName,
              totalStock: 0, // detail API에서 재고 미포함 — 표시 생략
              quantity: it.quantity,
            }))
          )

          // costMode
          setCostMode(r.costMode)

          // TOTAL
          setTotalCostInput(r.totalCost != null ? String(r.totalCost) : '')

          // BREAKDOWN costs
          if (r.costs.length > 0) {
            setCostRows(
              r.costs.map((c) => ({
                _key: crypto.randomUUID(),
                itemName: c.itemName,
                description: c.description ?? '',
                spec: c.spec != null ? String(c.spec) : '',
                quantity: String(c.quantity),
                unitPrice: String(c.unitPrice),
                note: c.note ?? '',
              }))
            )
          } else {
            setCostRows([newCostRow()])
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : '불러오기 실패')
        } finally {
          if (!cancelled) setLoadingDetail(false)
        }
      }
      load()
      return () => {
        cancelled = true
      }
    } else {
      // 신규 모드
      resetForm()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runId])

  // ── 옵션 피커에서 픽업
  function handlePick(opt: PickedOption) {
    // 이미 추가된 옵션이면 무시
    if (optionItems.some((it) => it.optionId === opt.optionId)) return
    setOptionItems((prev) => [
      ...prev,
      {
        optionId: opt.optionId,
        optionName: opt.optionName,
        sku: opt.sku,
        productId: opt.productId,
        productName: opt.productName,
        brandName: opt.brandName,
        totalStock: opt.totalStock,
        quantity: 1,
      },
    ])
  }

  function removeOption(optionId: string) {
    setOptionItems((prev) => prev.filter((it) => it.optionId !== optionId))
  }

  function removeProduct(productId: string) {
    setOptionItems((prev) => prev.filter((it) => it.productId !== productId))
  }

  function updateQuantity(optionId: string, val: string) {
    setOptionItems((prev) =>
      prev.map((it) => (it.optionId === optionId ? { ...it, quantity: parseInt(val) || 0 } : it))
    )
  }

  // ── 원가 행 조작
  function addCostRow() {
    setCostRows((prev) => [...prev, newCostRow()])
  }

  function removeCostRow(key: string) {
    setCostRows((prev) => prev.filter((r) => r._key !== key))
  }

  function updateCostRow(key: string, field: keyof Omit<CostRow, '_key'>, val: string) {
    setCostRows((prev) => prev.map((r) => (r._key === key ? { ...r, [field]: val } : r)))
  }

  // ── 합계
  const breakdownTotal = costRows.reduce((s, r) => s + calcRowAmount(r), 0)

  // ── 저장
  async function handleSave() {
    // 검증
    if (!runNo.trim()) {
      toast.error('차수 번호를 입력하세요')
      return
    }
    if (!orderedAt) {
      toast.error('발주일을 입력하세요')
      return
    }
    if (optionItems.length === 0) {
      toast.error('1개 이상의 옵션을 추가하세요')
      return
    }
    const invalidQty = optionItems.find((it) => it.quantity <= 0)
    if (invalidQty) {
      toast.error(`"${invalidQty.optionName}" 발주 수량을 1 이상으로 입력하세요`)
      return
    }

    if (costMode === 'TOTAL') {
      const v = parseFloat(totalCostInput)
      if (isNaN(v) || v < 0) {
        toast.error('총 원가를 올바르게 입력하세요')
        return
      }
    } else {
      if (costRows.length === 0) {
        toast.error('원가 항목을 1개 이상 추가하세요')
        return
      }
      for (const row of costRows) {
        if (!row.itemName.trim()) {
          toast.error('원가 항목 이름을 모두 입력하세요')
          return
        }
        if (!row.quantity || parseFloat(row.quantity) <= 0) {
          toast.error(`"${row.itemName}" 수량을 1 이상으로 입력하세요`)
          return
        }
        if (!row.unitPrice || parseFloat(row.unitPrice) <= 0) {
          toast.error(`"${row.itemName}" 단가를 입력하세요`)
          return
        }
      }
    }

    // body 구성
    const body: Record<string, unknown> = {
      runNo: runNo.trim(),
      orderedAt,
      costMode,
      memo: memo.trim() || undefined,
      items: optionItems.map((it) => ({ optionId: it.optionId, quantity: it.quantity })),
    }

    if (costMode === 'TOTAL') {
      body.totalCost = parseFloat(totalCostInput)
      body.costs = []
    } else {
      // BREAKDOWN: totalCost는 서버가 계산 — 미전송
      body.costs = costRows.map((r, i) => ({
        itemName: r.itemName.trim(),
        description: r.description.trim() || undefined,
        spec: r.spec ? parseFloat(r.spec) : undefined,
        quantity: parseFloat(r.quantity),
        unitPrice: parseFloat(r.unitPrice),
        note: r.note.trim() || undefined,
        sortOrder: i,
      }))
    }

    setSaving(true)
    try {
      const url = isEdit ? `/api/sh/production-runs/${runId}` : '/api/sh/production-runs'
      const method = isEdit ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err: { message?: string } = await res.json().catch(() => ({}))
        throw new Error(err.message ?? '저장 실패')
      }
      toast.success(isEdit ? `차수 ${runNo} 수정 완료` : `차수 ${runNo} 추가 완료`)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  // ── 상품별 그룹핑
  const productGroups = Array.from(
    optionItems.reduce((map, it) => {
      const existing = map.get(it.productId)
      if (existing) {
        existing.options.push(it)
      } else {
        map.set(it.productId, {
          productId: it.productId,
          productName: it.productName,
          brandName: it.brandName,
          options: [it],
        })
      }
      return map
    }, new Map<string, { productId: string; productName: string; brandName: string | null; options: OptionItem[] }>())
  ).map(([, v]) => v)

  // 이미 추가된 optionId 목록 (피커 exclude)
  const excludeOptionIds = optionItems.map((it) => it.optionId)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{isEdit ? '차수 수정' : '차수 추가'}</DialogTitle>
          </DialogHeader>

          {loadingDetail ? (
            <div className="flex flex-1 items-center justify-center py-16 text-sm text-muted-foreground">
              불러오는 중...
            </div>
          ) : (
            <div className="flex-1 space-y-6 overflow-y-auto px-1 py-2">
              {/* ── 섹션 1: 기본 정보 ─────────────────────────────────── */}
              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">기본 정보</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="runNo">
                      차수 번호 <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="runNo"
                      value={runNo}
                      onChange={(e) => setRunNo(e.target.value)}
                      placeholder="예: 2024-001"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="orderedAt">
                      발주일 <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="orderedAt"
                      type="date"
                      value={orderedAt}
                      onChange={(e) => setOrderedAt(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="memo">메모</Label>
                  <Textarea
                    id="memo"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="선택 사항"
                    rows={2}
                    className="resize-none"
                  />
                </div>
              </section>

              {/* ── 섹션 2: 발주 상품·옵션 ───────────────────────────── */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">발주 상품 · 옵션</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      pickerContextRef.current = null
                      setPickerOpen(true)
                    }}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    상품 추가
                  </Button>
                </div>

                {productGroups.length === 0 ? (
                  <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                    옵션을 추가하세요
                  </p>
                ) : (
                  <div className="space-y-3">
                    {productGroups.map((g) => (
                      <div key={g.productId} className="rounded-md border p-3">
                        {/* 상품 헤더 */}
                        <div className="mb-2 flex items-center justify-between">
                          <div>
                            <span className="text-sm font-medium">{g.productName}</span>
                            {g.brandName && (
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                {g.brandName}
                              </span>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            aria-label={`${g.productName} 전체 제거`}
                            onClick={() => removeProduct(g.productId)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>

                        {/* 옵션 행 */}
                        <div className="space-y-1.5">
                          {g.options.map((opt) => (
                            <div
                              key={opt.optionId}
                              className="flex items-center gap-2 rounded px-1 py-1"
                            >
                              <span className="min-w-0 flex-1 truncate text-sm">
                                {opt.optionName}
                                {opt.sku && (
                                  <span className="ml-1.5 text-xs text-muted-foreground">
                                    {opt.sku}
                                  </span>
                                )}
                              </span>
                              {opt.totalStock > 0 && (
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  재고 {opt.totalStock.toLocaleString('ko-KR')}
                                </span>
                              )}
                              <div className="flex shrink-0 items-center gap-1">
                                <Label
                                  htmlFor={`qty-${opt.optionId}`}
                                  className="text-xs text-muted-foreground"
                                >
                                  발주
                                </Label>
                                <Input
                                  id={`qty-${opt.optionId}`}
                                  type="number"
                                  min={1}
                                  value={opt.quantity || ''}
                                  onChange={(e) => updateQuantity(opt.optionId, e.target.value)}
                                  className="h-7 w-20 text-right text-sm"
                                />
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                                aria-label={`${opt.optionName} 제거`}
                                onClick={() => removeOption(opt.optionId)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>

                        {/* 같은 상품의 다른 옵션 추가 */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-1.5 h-7 text-xs text-muted-foreground"
                          onClick={() => {
                            pickerContextRef.current = g.productId
                            setPickerOpen(true)
                          }}
                        >
                          <Plus className="mr-1 h-3 w-3" />
                          다른 옵션 추가
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ── 섹션 3: 생산 원가 ─────────────────────────────────── */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">생산 원가</h3>
                <Tabs
                  value={costMode}
                  onValueChange={(v) => setCostMode(v as CostMode)}
                  className="w-full"
                >
                  <TabsList>
                    <TabsTrigger value="TOTAL">총원가 직접 입력</TabsTrigger>
                    <TabsTrigger value="BREAKDOWN">세부 항목 입력</TabsTrigger>
                  </TabsList>

                  {/* TOTAL 탭 */}
                  <TabsContent value="TOTAL" className="mt-4 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="totalCost">총 원가 (₩)</Label>
                      <Input
                        id="totalCost"
                        type="number"
                        min={0}
                        value={totalCostInput}
                        onChange={(e) => setTotalCostInput(e.target.value)}
                        placeholder="0"
                        className="max-w-xs"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      옵션별 단가는 입고 시 (총원가 ÷ 총 수량)으로 계산됩니다
                    </p>
                  </TabsContent>

                  {/* BREAKDOWN 탭 */}
                  <TabsContent value="BREAKDOWN" className="mt-4 space-y-3">
                    {costRows.length === 0 ? (
                      <p className="rounded-md border border-dashed py-4 text-center text-sm text-muted-foreground">
                        비용 항목을 추가하세요
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-xs text-muted-foreground">
                              <th className="pr-2 pb-1.5 text-left font-medium">비용항목 *</th>
                              <th className="pr-2 pb-1.5 text-left font-medium">상세</th>
                              <th className="w-16 pr-2 pb-1.5 text-right font-medium">규격</th>
                              <th className="w-16 pr-2 pb-1.5 text-right font-medium">수량 *</th>
                              <th className="w-24 pr-2 pb-1.5 text-right font-medium">단가 *</th>
                              <th className="w-24 pr-2 pb-1.5 text-right font-medium">금액</th>
                              <th className="w-20 pr-2 pb-1.5 text-left font-medium">비고</th>
                              <th className="w-7 pb-1.5" />
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {costRows.map((row) => {
                              const amount = calcRowAmount(row)
                              return (
                                <tr key={row._key}>
                                  <td className="py-1.5 pr-2">
                                    <Input
                                      value={row.itemName}
                                      onChange={(e) =>
                                        updateCostRow(row._key, 'itemName', e.target.value)
                                      }
                                      placeholder="항목명"
                                      className="h-7 text-sm"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-2">
                                    <Input
                                      value={row.description}
                                      onChange={(e) =>
                                        updateCostRow(row._key, 'description', e.target.value)
                                      }
                                      placeholder="상세"
                                      className="h-7 text-sm"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-2">
                                    <Input
                                      type="number"
                                      min={0}
                                      value={row.spec}
                                      onChange={(e) =>
                                        updateCostRow(row._key, 'spec', e.target.value)
                                      }
                                      placeholder="1"
                                      className="h-7 text-right text-sm"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-2">
                                    <Input
                                      type="number"
                                      min={1}
                                      value={row.quantity}
                                      onChange={(e) =>
                                        updateCostRow(row._key, 'quantity', e.target.value)
                                      }
                                      placeholder="0"
                                      className="h-7 text-right text-sm"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-2">
                                    <Input
                                      type="number"
                                      min={0}
                                      value={row.unitPrice}
                                      onChange={(e) =>
                                        updateCostRow(row._key, 'unitPrice', e.target.value)
                                      }
                                      placeholder="0"
                                      className="h-7 text-right text-sm"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-2 text-right text-sm text-muted-foreground">
                                    {amount > 0 ? fmtKRW(amount) : '-'}
                                  </td>
                                  <td className="py-1.5 pr-2">
                                    <Input
                                      value={row.note}
                                      onChange={(e) =>
                                        updateCostRow(row._key, 'note', e.target.value)
                                      }
                                      placeholder="비고"
                                      className="h-7 text-sm"
                                    />
                                  </td>
                                  <td className="py-1.5">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                      onClick={() => removeCostRow(row._key)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <Button type="button" variant="outline" size="sm" onClick={addCostRow}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        항목 추가
                      </Button>
                      {costRows.length > 0 && (
                        <p className="text-sm font-medium">
                          합계 <span className="text-base">{fmtKRW(breakdownTotal)}</span>
                        </p>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </section>
            </div>
          )}

          <DialogFooter className="shrink-0 border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              취소
            </Button>
            <Button onClick={handleSave} disabled={saving || loadingDetail}>
              {saving ? '저장 중...' : isEdit ? '수정' : '추가'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 옵션 피커 (다이얼로그 위에 중첩) */}
      <OptionPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={handlePick}
        excludeOptionIds={excludeOptionIds}
        initialQuery={
          pickerContextRef.current != null
            ? (productGroups.find((g) => g.productId === pickerContextRef.current)?.productName ??
              '')
            : ''
        }
      />
    </>
  )
}
