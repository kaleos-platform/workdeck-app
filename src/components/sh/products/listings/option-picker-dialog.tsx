'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { productDisplayName } from '@/lib/sh/product-display'

type ProductRow = {
  id: string
  name: string
  internalName?: string | null
  code: string | null
  msrp?: string | number | null
  brand?: { id: string; name: string } | null
  options: {
    id: string
    name: string
    sku: string | null
    retailPrice?: string | number | null
    totalStock?: number
  }[]
}

export type PickedOption = {
  optionId: string
  optionName: string
  productId: string
  productName: string
  sku: string | null
  brandName: string | null
  retailPrice: number | null
  totalStock: number
}

export type PickedOptionWithQty = PickedOption & { quantity: number }

type ProductWithOptions = {
  productId: string
  productName: string
  code: string | null
  brandName: string | null
  options: PickedOption[]
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  // flat/two-step 모드: 단일 선택
  onPick?: (opt: PickedOption) => void
  // multi-with-qty 모드: 다중 선택+수량
  onPickMulti?: (items: PickedOptionWithQty[]) => void
  excludeOptionIds?: string[]
  initialQuery?: string
  // 'flat' (default): 상품+옵션을 한 리스트로 표시
  // 'two-step': 1단계 상품 선택 → 2단계 그 상품의 옵션 선택
  // 'multi-with-qty': two-step + 다중 체크박스+수량 입력, onPickMulti 사용
  mode?: 'flat' | 'two-step' | 'multi-with-qty'
  contextLabel?: string
  contextValue?: string
  // multi-with-qty 수정 시 기존 선택 복원
  initialItems?: PickedOptionWithQty[]
}

export function OptionPickerDialog({
  open,
  onOpenChange,
  onPick,
  onPickMulti,
  excludeOptionIds = [],
  initialQuery = '',
  mode = 'flat',
  contextLabel,
  contextValue,
  initialItems,
}: Props) {
  const [search, setSearch] = useState(initialQuery)
  const [debounced, setDebounced] = useState(initialQuery)
  const [products, setProducts] = useState<ProductWithOptions[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)

  // multi-with-qty: 누적 선택 items (여러 상품에 걸쳐 유지)
  const [accumulatedItems, setAccumulatedItems] = useState<PickedOptionWithQty[]>([])

  useEffect(() => {
    if (open) {
      setSearch(initialQuery)
      setDebounced(initialQuery)
      setSelectedProductId(null)
      // initialItems로 복원 또는 초기화
      setAccumulatedItems(initialItems ? [...initialItems] : [])
    } else {
      // 닫힐 때 누적 state 초기화
      setAccumulatedItems([])
    }
  }, [open, initialQuery, initialItems])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const qs = new URLSearchParams()
        qs.set('pageSize', '20')
        if (debounced.trim()) qs.set('search', debounced.trim())
        const res = await fetch(`/api/sh/products?${qs.toString()}`)
        if (!res.ok) throw new Error('검색 실패')
        const data: { data?: ProductRow[]; products?: ProductRow[] } = await res.json()
        if (cancelled) return
        const rows = data.data ?? data.products ?? []
        const grouped: ProductWithOptions[] = rows.map((p) => {
          const productMsrp = p.msrp != null ? Number(p.msrp) : null
          const displayName = productDisplayName(p)
          const brandName = p.brand?.name ?? null
          return {
            productId: p.id,
            productName: displayName,
            code: p.code,
            brandName,
            options: (p.options ?? []).map((o) => ({
              optionId: o.id,
              optionName: o.name,
              productId: p.id,
              productName: displayName,
              sku: o.sku,
              brandName,
              retailPrice: o.retailPrice != null ? Number(o.retailPrice) : productMsrp,
              totalStock: typeof o.totalStock === 'number' ? o.totalStock : 0,
            })),
          }
        })
        setProducts(grouped)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '검색 실패')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, debounced])

  const excluded = useMemo(() => new Set(excludeOptionIds), [excludeOptionIds])

  const flatVisible = useMemo(
    () => products.flatMap((p) => p.options).filter((o) => !excluded.has(o.optionId)),
    [products, excluded]
  )

  const productsVisible = useMemo(() => {
    return products
      .map((p) => ({ ...p, options: p.options.filter((o) => !excluded.has(o.optionId)) }))
      .filter((p) => p.options.length > 0)
  }, [products, excluded])

  const selectedProduct = useMemo(
    () => productsVisible.find((p) => p.productId === selectedProductId) ?? null,
    [productsVisible, selectedProductId]
  )

  const isMultiMode = mode === 'multi-with-qty'
  const showProductStep = (mode === 'two-step' || isMultiMode) && !selectedProduct
  const showOptionStep = (mode === 'two-step' || isMultiMode) && !!selectedProduct

  // multi-with-qty: 현재 상품의 옵션에 대한 체크/수량 변경
  function toggleOptionCheck(opt: PickedOption, checked: boolean) {
    setAccumulatedItems((prev) => {
      if (checked) {
        if (prev.some((i) => i.optionId === opt.optionId)) return prev
        return [...prev, { ...opt, quantity: 1 }]
      } else {
        return prev.filter((i) => i.optionId !== opt.optionId)
      }
    })
  }

  function updateOptionQty(optionId: string, raw: string) {
    const parsed = parseInt(raw, 10)
    const qty = isNaN(parsed) || parsed < 1 ? 1 : parsed
    setAccumulatedItems((prev) =>
      prev.map((i) => (i.optionId === optionId ? { ...i, quantity: qty } : i))
    )
  }

  function handleMultiComplete() {
    if (accumulatedItems.length === 0) {
      toast.error('옵션을 하나 이상 선택하세요')
      return
    }
    onPickMulti?.(accumulatedItems)
    onOpenChange(false)
  }

  const titleText = useMemo(() => {
    if (isMultiMode) {
      if (showProductStep) return '상품 선택'
      return `옵션 선택 — ${selectedProduct?.productName ?? ''}`
    }
    if (mode === 'two-step') {
      if (showProductStep) return '상품 선택'
      return `옵션 선택 — ${selectedProduct?.productName ?? ''}`
    }
    return '옵션 선택'
  }, [isMultiMode, mode, showProductStep, selectedProduct])

  const descText = useMemo(() => {
    if (isMultiMode) {
      if (showProductStep) return '상품을 선택하세요 (여러 상품 추가 가능)'
      return '옵션별 체크박스와 수량을 설정하세요'
    }
    if (mode === 'two-step') {
      if (showProductStep) return '상품을 먼저 선택하세요'
      return '옵션을 선택하세요'
    }
    return '상품명·관리코드로 검색해 묶음에 포함할 옵션을 선택하세요'
  }, [isMultiMode, mode, showProductStep])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl">
        <DialogHeader>
          <DialogTitle>{titleText}</DialogTitle>
          <DialogDescription>{descText}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {contextValue && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <span className="text-xs text-amber-700">{contextLabel ?? '매칭 대상'}</span>
              <p className="mt-0.5 font-medium text-amber-900">{contextValue}</p>
            </div>
          )}

          {showOptionStep && (
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 w-fit"
                onClick={() => setSelectedProductId(null)}
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                다른 상품 선택
              </Button>
              {isMultiMode && accumulatedItems.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  선택된 옵션 {accumulatedItems.length}개
                </span>
              )}
            </div>
          )}

          {!showOptionStep && (
            <div className="space-y-1">
              <Label htmlFor="option-picker-search">검색</Label>
              <div className="relative">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="option-picker-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={
                    mode === 'two-step' || isMultiMode
                      ? '상품명 / 관리코드'
                      : '상품명 / 관리코드 / SKU'
                  }
                  className="pl-9"
                />
              </div>
              {isMultiMode && accumulatedItems.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  선택된 옵션 {accumulatedItems.length}개
                </p>
              )}
            </div>
          )}

          <div className="max-h-[50vh] overflow-y-auto rounded-md border">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">검색 중...</div>
            ) : showProductStep ? (
              productsVisible.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {debounced ? '검색 결과가 없습니다' : '검색어를 입력하세요'}
                </div>
              ) : (
                <ul className="divide-y">
                  {productsVisible.map((p) => (
                    <li key={p.productId}>
                      <button
                        type="button"
                        onClick={() => setSelectedProductId(p.productId)}
                        className="w-full px-4 py-3 text-left transition hover:bg-muted/60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{p.productName}</p>
                            <p className="text-sm text-muted-foreground">
                              옵션 {p.options.length}개
                              {isMultiMode &&
                                (() => {
                                  const n = p.options.filter((o) =>
                                    accumulatedItems.some((i) => i.optionId === o.optionId)
                                  ).length
                                  return n > 0 ? (
                                    <span className="ml-2 text-primary">· {n}개 선택됨</span>
                                  ) : null
                                })()}
                            </p>
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            {p.code && <p>{p.code}</p>}
                            {p.brandName && <p>{p.brandName}</p>}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : showOptionStep && isMultiMode ? (
              // multi-with-qty: 체크박스 + 수량 입력
              selectedProduct!.options.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  선택 가능한 옵션이 없습니다
                </div>
              ) : (
                <ul className="divide-y">
                  {selectedProduct!.options.map((o) => {
                    const accumulated = accumulatedItems.find((i) => i.optionId === o.optionId)
                    const checked = !!accumulated
                    return (
                      <li key={o.optionId} className="flex items-center gap-3 px-4 py-3">
                        <Checkbox
                          id={`mqo-${o.optionId}`}
                          checked={checked}
                          onCheckedChange={(v) => toggleOptionCheck(o, !!v)}
                        />
                        <label
                          htmlFor={`mqo-${o.optionId}`}
                          className="flex-1 cursor-pointer text-sm font-medium"
                        >
                          {o.optionName}
                          {o.sku && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              SKU {o.sku}
                            </span>
                          )}
                        </label>
                        {checked && (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground">수량</span>
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              value={accumulated!.quantity}
                              onChange={(e) => updateOptionQty(o.optionId, e.target.value)}
                              className="h-7 w-16 text-center text-sm"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )
            ) : showOptionStep ? (
              // two-step 단일 선택
              selectedProduct!.options.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  선택 가능한 옵션이 없습니다
                </div>
              ) : (
                <ul className="divide-y">
                  {selectedProduct!.options.map((o) => (
                    <li key={o.optionId}>
                      <button
                        type="button"
                        onClick={() => onPick?.(o)}
                        className="w-full px-4 py-3 text-left transition hover:bg-muted/60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{o.optionName}</p>
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            {o.sku && <p>SKU {o.sku}</p>}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : flatVisible.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {debounced ? '검색 결과가 없습니다' : '검색어를 입력하세요'}
              </div>
            ) : (
              <ul className="divide-y">
                {flatVisible.map((r) => (
                  <li key={r.optionId}>
                    <button
                      type="button"
                      onClick={() => onPick?.(r)}
                      className="w-full px-4 py-3 text-left transition hover:bg-muted/60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{r.productName}</p>
                          <p className="text-sm text-muted-foreground">{r.optionName}</p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          {r.sku && <p>SKU {r.sku}</p>}
                          {r.brandName && <p>{r.brandName}</p>}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          {isMultiMode ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                닫기
              </Button>
              <Button onClick={handleMultiComplete} disabled={accumulatedItems.length === 0}>
                완료 {accumulatedItems.length > 0 && `(${accumulatedItems.length}개)`}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              닫기
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
