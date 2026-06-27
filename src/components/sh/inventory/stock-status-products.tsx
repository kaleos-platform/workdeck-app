'use client'

import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, Pin, PinOff, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { StockBrand } from './stock-status.types'
import { STOCK_STATUS_BRAND_NONE, type StockStatusProductCard } from './stock-status-view-model'

type Props = {
  products: StockStatusProductCard[]
  brands: StockBrand[]
  loading?: boolean
  selectedProductId: string | null
  selectedBrandId: string | null
  selectedGroupId: string | null
  productQuery: string
  pinnedProductIds: string[]
  collapsed: boolean
  onSelectProduct: (productId: string | null) => void
  onToggleCollapsed: () => void
  onTogglePinned: (productId: string) => void
  onBrandChange: (brandId: string | null) => void
  onGroupChange: (groupId: string | null) => void
  onSearchChange: (q: string) => void
}

const PINNED_LABEL = '고정 상품'
type StatusTone = 'out' | 'low' | 'over' | 'ok'

export function StockStatusProducts({
  products,
  brands,
  loading,
  selectedProductId,
  selectedBrandId,
  selectedGroupId,
  productQuery,
  pinnedProductIds,
  collapsed,
  onSelectProduct,
  onToggleCollapsed,
  onTogglePinned,
  onBrandChange,
  onGroupChange,
  onSearchChange,
}: Props) {
  const pinnedSet = useMemo(() => new Set(pinnedProductIds), [pinnedProductIds])

  const groupOptions = useMemo(() => {
    if (selectedBrandId === null) {
      const seen = new Map<string, { id: string; name: string }>()
      for (const brand of brands) {
        for (const group of brand.groups) {
          if (!seen.has(group.id)) seen.set(group.id, { id: group.id, name: group.name })
        }
      }
      return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    }

    if (selectedBrandId === STOCK_STATUS_BRAND_NONE) {
      const noneBrand = brands.find((brand) => brand.id === null)
      return noneBrand ? noneBrand.groups.map((group) => ({ id: group.id, name: group.name })) : []
    }

    const brand = brands.find((item) => item.id === selectedBrandId)
    return brand ? brand.groups.map((group) => ({ id: group.id, name: group.name })) : []
  }, [brands, selectedBrandId])

  const brandSelectValue =
    selectedBrandId === null
      ? '__all__'
      : selectedBrandId === ''
        ? STOCK_STATUS_BRAND_NONE
        : selectedBrandId
  const groupSelectValue = selectedGroupId ?? '__all__'

  const pinnedProducts = useMemo(
    () => products.filter((product) => pinnedSet.has(product.productId)),
    [pinnedSet, products]
  )
  const normalProducts = useMemo(
    () => products.filter((product) => !pinnedSet.has(product.productId)),
    [pinnedSet, products]
  )

  if (collapsed) {
    return (
      <Card className="flex h-full min-h-0 flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between border-b py-4">
          <CardTitle className="text-sm">상품</CardTitle>
          <Button variant="outline" size="xs" onClick={onToggleCollapsed} aria-label="상품 펼치기">
            <ChevronRight className="h-3.5 w-3.5" />
            펼치기
          </Button>
        </CardHeader>
        <CardContent className="flex-1 p-4" />
      </Card>
    )
  }

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="gap-3 border-b">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">상품</CardTitle>
            <Badge variant="outline" className="rounded-full text-[11px] font-medium">
              {products.length}개
            </Badge>
          </div>
          <Button variant="outline" size="xs" onClick={onToggleCollapsed} aria-label="상품 접기">
            <ChevronLeft className="h-3.5 w-3.5" />
            접기
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={productQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="상품 검색"
            className="h-9 pl-9"
          />
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <Select
            value={brandSelectValue}
            onValueChange={(value) => {
              if (value === '__all__') onBrandChange(null)
              else onBrandChange(value)
            }}
          >
            <SelectTrigger className="h-9 w-full" aria-label="브랜드 필터">
              <SelectValue placeholder="전체 브랜드" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">전체 브랜드</SelectItem>
              {brands
                .filter((brand) => brand.id !== null)
                .map((brand) => (
                  <SelectItem key={brand.id!} value={brand.id!}>
                    {brand.name}
                  </SelectItem>
                ))}
              {brands.some((brand) => brand.id === null) && (
                <SelectItem value={STOCK_STATUS_BRAND_NONE}>브랜드 없음</SelectItem>
              )}
            </SelectContent>
          </Select>

          <Select
            value={groupSelectValue}
            onValueChange={(value) => onGroupChange(value === '__all__' ? null : value)}
          >
            <SelectTrigger className="h-9 w-full" aria-label="카테고리 필터">
              <SelectValue placeholder="전체 카테고리" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">전체 카테고리</SelectItem>
              {groupOptions.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">상품 데이터가 없습니다</p>
        ) : (
          <div className="space-y-3">
            {pinnedProducts.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 px-2 text-[11px] font-medium text-muted-foreground">
                  <Pin className="h-3.5 w-3.5" />
                  {PINNED_LABEL}
                </div>
                <div className="space-y-1.5">
                  {pinnedProducts.map((product) => (
                    <ProductButton
                      key={product.productId}
                      product={product}
                      active={selectedProductId === product.productId}
                      pinned
                      onSelectProduct={onSelectProduct}
                      onTogglePinned={onTogglePinned}
                    />
                  ))}
                </div>
              </div>
            )}

            {pinnedProducts.length > 0 && normalProducts.length > 0 && (
              <div className="h-px bg-border" aria-hidden="true" />
            )}

            <div className="space-y-1.5">
              {normalProducts.map((product) => (
                <ProductButton
                  key={product.productId}
                  product={product}
                  active={selectedProductId === product.productId}
                  pinned={false}
                  onSelectProduct={onSelectProduct}
                  onTogglePinned={onTogglePinned}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

type ProductButtonProps = {
  product: StockStatusProductCard
  active: boolean
  pinned: boolean
  onSelectProduct: (productId: string | null) => void
  onTogglePinned: (productId: string) => void
}

function ProductButton({
  product,
  active,
  pinned,
  onSelectProduct,
  onTogglePinned,
}: ProductButtonProps) {
  return (
    <div
      className={cn(
        'w-full rounded-lg border px-3 py-2 text-left transition-colors',
        active
          ? 'border-primary/30 bg-muted/70 shadow-xs ring-1 ring-primary/10'
          : 'bg-card hover:bg-muted/40'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          aria-pressed={active}
          onClick={() => onSelectProduct(product.productId)}
          className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <div className="space-y-0.5">
            <div className="truncate text-sm font-medium">{product.productName}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {product.brandName ?? '브랜드 없음'} · {product.groupName}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <StatusSticker label="결품" count={product.outOptionCount} tone="out" />
            <StatusSticker label="부족" count={product.lowOptionCount} tone="low" />
            <StatusSticker label="과잉" count={product.overOptionCount} tone="over" />
            <StatusSticker label="정상" count={product.okOptionCount} tone="ok" />
          </div>
        </button>

        <div className="flex items-start gap-1.5">
          <Badge variant="outline" className="rounded-full text-[11px] font-medium tabular-nums">
            {product.optionCount}개
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={pinned ? '상품 고정 해제' : '상품 고정'}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onTogglePinned(product.productId)
            }}
          >
            {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

function StatusSticker({ label, count, tone }: { label: string; count: number; tone: StatusTone }) {
  const toneClass: Record<StatusTone, string> = {
    out: 'border-red-200 bg-red-50 text-red-700',
    low: 'border-amber-200 bg-amber-50 text-amber-700',
    over: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium',
        toneClass[tone]
      )}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums">{count > 0 ? count : '—'}</span>
    </span>
  )
}
