'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { groupOptionsByPrice, type PriceGroup } from '@/lib/sh/price-group'
import type { ResolvedComponent } from './pricing-bundle-row'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

// /api/sh/pricing-options 응답 형태 (가격있는 옵션)
type PricingOptionRaw = {
  optionId: string
  optionName: string
  sku: string | null
  productId: string
  productName: string
  brandName: string | null
  costPrice: number | null
  retailPrice: number | null
  totalStock: number
  msrp: number | null
}

// /api/sh/products/[productId]/options 응답 형태
type ApiProductOption = {
  id: string
  name: string
  sku: string | null
  costPrice: string | number | null
  /** 생산차수 원가 연동 시 파생 원가 (아니면 costPrice와 동일) */
  effectiveCostPrice?: string | number | null
  retailPrice: string | number | null
  sizeLabel: string | null
  attributeValues: Record<string, string> | null
  totalStock: number
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** 확인 시 확정된 컴포넌트 전달 */
  onConfirm: (component: ResolvedComponent) => void
  /** 수정 모드: 기존 값 복원 (상품·가격그룹·수량) */
  initial?: ResolvedComponent | null
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────────

/**
 * 상품 선택 팝업 — 2단계.
 * step1: 상품 리스트(pricing-options, 가격있는 옵션 → 상품 dedup) 검색·선택
 * step2: 가격 그룹 선택 + 번들 내 수량 → 확인
 *
 * 옵션 선택 단계는 없음 — 가격 그룹이 옵션 집합을 대표한다.
 * 확인 시 ResolvedComponent(optionIds = 그룹 전체 옵션 포함)를 onConfirm으로 전달.
 */
export function PricingProductPickerDialog({ open, onOpenChange, onConfirm, initial }: Props) {
  // ── step1: 상품 검색 ─────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [searchResults, setSearchResults] = useState<PricingOptionRaw[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  // 선택된 상품
  const [selectedProduct, setSelectedProduct] = useState<{
    productId: string
    productName: string
  } | null>(null)

  // ── step2: 가격 그룹 + 수량 ──────────────────────────────────────────────
  const [priceGroups, setPriceGroups] = useState<PriceGroup[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>('')
  const [quantity, setQuantity] = useState(1)

  // ── 상품 → 가격 그룹 로드 ────────────────────────────────────────────────
  const loadGroups = useCallback(async (productId: string): Promise<PriceGroup[]> => {
    setGroupsLoading(true)
    try {
      const res = await fetch(`/api/sh/products/${productId}/options`)
      if (!res.ok) throw new Error('옵션 조회 실패')
      const data: { options: ApiProductOption[] } = await res.json()
      const options = data.options ?? []
      const converted = options.map((o) => ({
        optionId: o.id,
        optionName: o.name,
        costPrice:
          (o.effectiveCostPrice ?? o.costPrice) != null
            ? Number(o.effectiveCostPrice ?? o.costPrice)
            : null,
        retailPrice: o.retailPrice != null ? Number(o.retailPrice) : null,
        attributeValues: o.attributeValues,
        sizeLabel: o.sizeLabel,
      }))
      const groups = groupOptionsByPrice(converted)
      setPriceGroups(groups)
      return groups
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '옵션 조회 실패')
      setPriceGroups([])
      return []
    } finally {
      setGroupsLoading(false)
    }
  }, [])

  // ── 다이얼로그 열림 시 초기화 / 수정 모드 복원 ────────────────────────────
  useEffect(() => {
    if (!open) return
    setSearch('')
    setDebounced('')
    setSearchResults([])
    if (initial) {
      // 수정 모드: 상품·수량 복원 후 가격 그룹 로드 → 기존 그룹 선택
      setSelectedProduct({ productId: initial.productId, productName: initial.productName })
      setQuantity(Math.max(1, initial.quantity))
      setSelectedGroupKey('')
      loadGroups(initial.productId).then((groups) => {
        // optionIds로 기존 그룹 매칭
        const match = groups.find((g) => g.optionIds.some((id) => initial.optionIds.includes(id)))
        if (match) setSelectedGroupKey(match.key)
      })
    } else {
      setSelectedProduct(null)
      setPriceGroups([])
      setSelectedGroupKey('')
      setQuantity(1)
    }
  }, [open, initial, loadGroups])

  // ── 검색 디바운스 ────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // ── 상품 검색 ────────────────────────────────────────────────────────────
  // 빈 검색(debounced='')이면 전체 첫 페이지를 불러와 팝업 열자마자 목록 표시.
  // 서버(/api/sh/pricing-options)는 빈 search 시 OR 필터 없이 전체 반환.
  useEffect(() => {
    if (!open || selectedProduct) return
    let cancelled = false
    const load = async () => {
      setSearchLoading(true)
      try {
        const qs = new URLSearchParams({ search: debounced.trim(), pageSize: '100' })
        const res = await fetch(`/api/sh/pricing-options?${qs.toString()}`)
        if (!res.ok) throw new Error('검색 실패')
        const data: { data: PricingOptionRaw[] } = await res.json()
        if (!cancelled) setSearchResults(data.data ?? [])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '검색 실패')
      } finally {
        if (!cancelled) setSearchLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, debounced, selectedProduct])

  // 검색 결과 → 상품 단위 dedup
  const productHits = useMemo(() => {
    const seen = new Set<string>()
    const hits: { productId: string; productName: string }[] = []
    for (const r of searchResults) {
      if (!seen.has(r.productId)) {
        seen.add(r.productId)
        hits.push({ productId: r.productId, productName: r.productName })
      }
    }
    return hits
  }, [searchResults])

  // ── 상품 선택 → step2 ────────────────────────────────────────────────────
  const handlePickProduct = (hit: { productId: string; productName: string }) => {
    setSelectedProduct(hit)
    setSearch('')
    setSearchResults([])
    setSelectedGroupKey('')
    setQuantity(1)
    loadGroups(hit.productId)
  }

  // 선택된 그룹
  const selectedGroup = useMemo(
    () => priceGroups.find((g) => g.key === selectedGroupKey) ?? null,
    [priceGroups, selectedGroupKey]
  )

  // ── 확인 ─────────────────────────────────────────────────────────────────
  const canConfirm = !!selectedProduct && !!selectedGroup && !selectedGroup.priceUndefined

  const handleConfirm = () => {
    if (!selectedProduct || !selectedGroup || selectedGroup.priceUndefined) return
    onConfirm({
      productId: selectedProduct.productId,
      productName: selectedProduct.productName,
      optionId: selectedGroup.representativeOptionId,
      optionIds: selectedGroup.optionIds,
      costPrice: selectedGroup.costPrice ?? 0,
      retailPrice: selectedGroup.retailPrice ?? 0,
      quantity: Math.max(1, quantity),
    })
    onOpenChange(false)
  }

  const showProductStep = !selectedProduct

  // ── 렌더 ──────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-xl">
        <DialogHeader>
          <DialogTitle>{showProductStep ? '상품 선택' : '가격 그룹 · 수량'}</DialogTitle>
          <DialogDescription>
            {showProductStep
              ? '상품명 / SKU로 검색해 상품을 선택하세요'
              : '가격 그룹과 번들 내 수량을 설정하세요 (옵션은 그룹 전체가 포함됩니다)'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* step1: 상품 검색 */}
          {showProductStep ? (
            <>
              <div className="relative">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="상품명 / SKU 검색"
                  className="pl-9"
                  autoFocus
                />
              </div>
              <div className="max-h-[50vh] min-h-[8rem] overflow-y-auto rounded-md border">
                {searchLoading ? (
                  <p className="p-8 text-center text-sm text-muted-foreground">검색 중...</p>
                ) : productHits.length === 0 ? (
                  <p className="p-8 text-center text-sm text-muted-foreground">
                    {debounced ? '검색 결과가 없습니다' : '상품이 없습니다'}
                  </p>
                ) : (
                  <ul className="divide-y">
                    {productHits.map((hit) => (
                      <li key={hit.productId}>
                        <button
                          type="button"
                          onClick={() => handlePickProduct(hit)}
                          className="w-full px-4 py-3 text-left text-sm transition hover:bg-muted/60"
                        >
                          {hit.productName}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            /* step2: 가격 그룹 + 수량 */
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 w-fit"
                onClick={() => {
                  setSelectedProduct(null)
                  setPriceGroups([])
                  setSelectedGroupKey('')
                }}
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                다른 상품 선택
              </Button>

              <div className="rounded-md border bg-muted/20 px-3 py-2">
                <p className="text-sm font-medium">{selectedProduct.productName}</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">가격 그룹</Label>
                {groupsLoading ? (
                  <p className="text-xs text-muted-foreground">옵션 로딩 중...</p>
                ) : priceGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">옵션 없음</p>
                ) : (
                  <Select value={selectedGroupKey} onValueChange={setSelectedGroupKey}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="가격 그룹 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {priceGroups.map((g) => (
                        <SelectItem key={g.key} value={g.key} disabled={g.priceUndefined}>
                          {g.sharedLabel}
                          {g.priceUndefined && (
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              (원가 미정)
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* 가격 정보 + 옵션 수 */}
              {selectedGroup && !selectedGroup.priceUndefined && (
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>
                    원가{' '}
                    <span className="font-medium text-foreground">
                      {fmt(selectedGroup.costPrice ?? 0)}원
                    </span>
                  </span>
                  <span>
                    소비자가{' '}
                    <span className="font-medium text-foreground">
                      {fmt(selectedGroup.retailPrice ?? 0)}원
                    </span>
                  </span>
                  <span>
                    포함 옵션{' '}
                    <span className="font-medium text-foreground">
                      {selectedGroup.optionIds.length}개
                    </span>
                  </span>
                </div>
              )}

              {/* 수량 */}
              {selectedGroup && !selectedGroup.priceUndefined && (
                <div className="flex items-center gap-2">
                  <Label className="shrink-0 text-xs">번들 내 수량</Label>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0 text-xs"
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    >
                      −
                    </Button>
                    <span className="w-8 text-center text-sm font-medium tabular-nums">
                      {quantity}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0 text-xs"
                      onClick={() => setQuantity((q) => q + 1)}
                    >
                      +
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          {!showProductStep && (
            <Button onClick={handleConfirm} disabled={!canConfirm}>
              확인
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
