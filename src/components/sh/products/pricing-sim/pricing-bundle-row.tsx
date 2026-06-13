'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

// ─── 타입 ──────────────────────────────────────────────────────────────────────

// /api/sh/pricing-options 응답 형태
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
  retailPrice: string | number | null
  sizeLabel: string | null
  attributeValues: Record<string, string> | null
  totalStock: number
}

/** 부모에게 전달하는 확정된 번들 컴포넌트 */
export type ResolvedComponent = {
  productId: string
  productName: string
  optionId: string
  costPrice: number
  retailPrice: number
  quantity: number
}

type Props = {
  /** 행 고유 ID — 부모가 관리 (인덱스 대신 안정 ID 사용) */
  rowId: string
  rowIndex: number
  /** onChange(rowId, component | null) — 부모가 useCallback으로 안정화 필수 */
  onChange: (rowId: string, component: ResolvedComponent | null) => void
  onRemove: (rowId: string) => void
  showRemove: boolean
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────────

/**
 * 번들 행 1개 — 자체 상품 검색/가격 그룹/옵션 확정/수량 상태를 보유하고,
 * 확정된 ResolvedComponent를 onChange(rowId, comp)로 상위에 전달한다.
 *
 * onChange는 부모가 useCallback([])로 안정화해야 렌더 루프를 방지한다.
 */
export function BundleRow({ rowId, rowIndex, onChange, onRemove, showRemove }: Props) {
  // ── 검색 ─────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [searchResults, setSearchResults] = useState<PricingOptionRaw[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  // 선택된 상품
  const [selectedProduct, setSelectedProduct] = useState<{
    productId: string
    productName: string
  } | null>(null)

  // 검색 디바운스
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // 상품 검색
  useEffect(() => {
    if (!debounced.trim()) {
      setSearchResults([])
      return
    }
    let cancelled = false
    const load = async () => {
      setSearchLoading(true)
      try {
        const qs = new URLSearchParams({ search: debounced.trim(), pageSize: '30' })
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
  }, [debounced])

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

  // ── 옵션 & 가격 그룹 ─────────────────────────────────────────────────────
  const [priceGroups, setPriceGroups] = useState<PriceGroup[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>('')
  const [groupOptions, setGroupOptions] = useState<ApiProductOption[]>([])
  const [selectedOptionId, setSelectedOptionId] = useState<string>('')

  // ── 수량 ─────────────────────────────────────────────────────────────────
  const [quantity, setQuantity] = useState(1)

  // ── 상품 선택 핸들러 ──────────────────────────────────────────────────────
  const handlePickProduct = async (hit: { productId: string; productName: string }) => {
    setSelectedProduct(hit)
    setSearch('')
    setSearchResults([])
    setPriceGroups([])
    setSelectedGroupKey('')
    setGroupOptions([])
    setSelectedOptionId('')

    setGroupsLoading(true)
    try {
      const res = await fetch(`/api/sh/products/${hit.productId}/options`)
      if (!res.ok) throw new Error('옵션 조회 실패')
      const data: { options: ApiProductOption[] } = await res.json()
      const options = data.options ?? []

      // Decimal → number 변환
      const converted = options.map((o) => ({
        ...o,
        costPrice: o.costPrice != null ? Number(o.costPrice) : null,
        retailPrice: o.retailPrice != null ? Number(o.retailPrice) : null,
      }))

      setGroupOptions(converted)
      const groups = groupOptionsByPrice(
        converted.map((o) => ({
          optionId: o.id,
          optionName: o.name,
          costPrice: o.costPrice as number | null,
          retailPrice: o.retailPrice as number | null,
          attributeValues: o.attributeValues,
          sizeLabel: o.sizeLabel,
        }))
      )
      setPriceGroups(groups)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '옵션 조회 실패')
    } finally {
      setGroupsLoading(false)
    }
  }

  // 선택된 그룹
  const selectedGroup = useMemo(
    () => priceGroups.find((g) => g.key === selectedGroupKey) ?? null,
    [priceGroups, selectedGroupKey]
  )

  // 그룹 내 구체 옵션 목록
  const groupMemberOptions = useMemo(() => {
    if (!selectedGroup) return []
    return groupOptions.filter((o) => selectedGroup.optionIds.includes(o.id))
  }, [selectedGroup, groupOptions])

  // 그룹 선택 → 대표 옵션 기본 설정
  const handleGroupChange = (key: string) => {
    setSelectedGroupKey(key)
    const group = priceGroups.find((g) => g.key === key)
    if (group) setSelectedOptionId(group.representativeOptionId)
  }

  // ── onChange 이펙트 — 확정값 계산 후 전달 ────────────────────────────────
  // onChange는 부모가 useCallback([])로 안정화 → 이펙트가 무한 루프에 빠지지 않음
  useEffect(() => {
    if (!selectedProduct || !selectedGroup || !selectedOptionId) {
      onChange(rowId, null)
      return
    }
    if (selectedGroup.priceUndefined) {
      onChange(rowId, null)
      return
    }
    onChange(rowId, {
      productId: selectedProduct.productId,
      productName: selectedProduct.productName,
      optionId: selectedOptionId,
      costPrice: selectedGroup.costPrice ?? 0,
      retailPrice: selectedGroup.retailPrice ?? 0,
      quantity: Math.max(1, quantity),
    })
    // onChange는 useCallback([]) 참조 안정 — dep에 포함해도 루프 없음
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId, selectedProduct, selectedGroup, selectedOptionId, quantity])

  // ── 상품 리셋 ──────────────────────────────────────────────────────────────
  const resetProduct = () => {
    setSelectedProduct(null)
    setPriceGroups([])
    setSelectedGroupKey('')
    setGroupOptions([])
    setSelectedOptionId('')
  }

  // ── 렌더 ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      {/* 행 헤더: 번호 + 제거 버튼 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">상품 {rowIndex + 1}</span>
        {showRemove && (
          <button
            type="button"
            onClick={() => onRemove(rowId)}
            className="text-muted-foreground hover:text-destructive"
            aria-label="행 제거"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 상품 검색 */}
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">상품</Label>
        {selectedProduct ? (
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5">
            <span className="flex-1 truncate text-sm font-medium">
              {selectedProduct.productName}
            </span>
            <button
              type="button"
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              onClick={resetProduct}
            >
              변경
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="상품명 / SKU 검색"
                className="h-8 pl-9 text-sm"
              />
            </div>
            {(searchLoading || productHits.length > 0) && (
              <div className="max-h-40 overflow-y-auto rounded-md border bg-popover shadow-md">
                {searchLoading ? (
                  <p className="p-3 text-center text-xs text-muted-foreground">검색 중...</p>
                ) : (
                  <ul className="divide-y">
                    {productHits.map((hit) => (
                      <li key={hit.productId}>
                        <button
                          type="button"
                          onClick={() => handlePickProduct(hit)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted/60"
                        >
                          {hit.productName}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 가격 그룹 + 구체 옵션 */}
      {selectedProduct && (
        <div className="space-y-2">
          <Label className="text-[11px] text-muted-foreground">가격 그룹</Label>
          {groupsLoading ? (
            <p className="text-xs text-muted-foreground">옵션 로딩 중...</p>
          ) : priceGroups.length === 0 ? (
            <p className="text-xs text-muted-foreground">옵션 없음</p>
          ) : (
            <Select value={selectedGroupKey} onValueChange={handleGroupChange}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="가격 그룹 선택" />
              </SelectTrigger>
              <SelectContent>
                {priceGroups.map((g) => (
                  <SelectItem key={g.key} value={g.key} disabled={g.priceUndefined}>
                    {g.sharedLabel}
                    {g.priceUndefined && (
                      <span className="ml-1 text-[10px] text-muted-foreground">(원가 미정)</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* 구체 옵션 확정 */}
          {selectedGroup && groupMemberOptions.length > 1 && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                옵션 확정 <span className="font-normal">(기본: 대표 옵션)</span>
              </Label>
              <Select value={selectedOptionId} onValueChange={setSelectedOptionId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="옵션 선택" />
                </SelectTrigger>
                <SelectContent>
                  {groupMemberOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                      {o.totalStock != null && (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          (재고 {o.totalStock.toLocaleString()})
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 가격 정보 표시 */}
          {selectedGroup && !selectedGroup.priceUndefined && (
            <div className="flex gap-3 text-[11px] text-muted-foreground">
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
            </div>
          )}
        </div>
      )}

      {/* 수량 */}
      {selectedGroup && !selectedGroup.priceUndefined && (
        <div className="flex items-center gap-2">
          <Label className="shrink-0 text-[11px] text-muted-foreground">번들 내 수량</Label>
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
            <span className="w-8 text-center text-sm font-medium tabular-nums">{quantity}</span>
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
          <Badge variant="secondary" className="ml-auto text-[10px]">
            원가 소계 {fmt((selectedGroup.costPrice ?? 0) * quantity)}원
          </Badge>
        </div>
      )}
    </div>
  )
}
