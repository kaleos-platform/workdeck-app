'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
  onPick: (opt: PickedOption) => void
  excludeOptionIds?: string[]
  initialQuery?: string
  // 'flat' (default): 상품+옵션을 한 리스트로 표시 (기존 동작)
  // 'two-step': 1단계 상품 선택 → 2단계 그 상품의 옵션 선택
  mode?: 'flat' | 'two-step'
  // 다이얼로그 상단에 표시할 컨텍스트(예: 매칭 대상 외부 상품명).
  // 검색창에는 자동 입력하지 않고 사용자에게 "무엇을 매칭하는지"만 보여준다.
  contextLabel?: string
  contextValue?: string
}

export function OptionPickerDialog({
  open,
  onOpenChange,
  onPick,
  excludeOptionIds = [],
  initialQuery = '',
  mode = 'flat',
  contextLabel,
  contextValue,
}: Props) {
  const [search, setSearch] = useState(initialQuery)
  const [debounced, setDebounced] = useState(initialQuery)
  const [products, setProducts] = useState<ProductWithOptions[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setSearch(initialQuery)
      setDebounced(initialQuery)
      setSelectedProductId(null)
    }
  }, [open, initialQuery])

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

  const showProductStep = mode === 'two-step' && !selectedProduct
  const showOptionStep = mode === 'two-step' && !!selectedProduct

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'two-step'
              ? showProductStep
                ? '상품 선택'
                : `옵션 선택 — ${selectedProduct?.productName ?? ''}`
              : '옵션 선택'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'two-step'
              ? showProductStep
                ? '상품을 먼저 선택하세요'
                : '옵션을 선택하세요'
              : '상품명·관리코드로 검색해 묶음에 포함할 옵션을 선택하세요'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {contextValue && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <span className="text-xs text-amber-700">{contextLabel ?? '매칭 대상'}</span>
              <p className="mt-0.5 font-medium text-amber-900">{contextValue}</p>
            </div>
          )}
          {showOptionStep && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 w-fit"
              onClick={() => setSelectedProductId(null)}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              상품 다시 선택
            </Button>
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
                    mode === 'two-step' ? '상품명 / 관리코드' : '상품명 / 관리코드 / SKU'
                  }
                  className="pl-9"
                />
              </div>
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
            ) : showOptionStep ? (
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
                        onClick={() => onPick(o)}
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
                      onClick={() => onPick(r)}
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
