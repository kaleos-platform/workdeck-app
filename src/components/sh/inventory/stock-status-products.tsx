'use client'

import { useMemo, useState } from 'react'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { StockBrand } from './stock-status.types'
import {
  STOCK_STATUS_BRAND_NONE,
  stockStatusDisplayName,
  type StockStatusProductCard,
} from './stock-status-view-model'

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
// 고정 상품을 제외한 일반 상품 목록의 페이지당 표시 개수.
// 그리드 높이를 ~1.4화면(lg:h-[calc(140vh-13rem)])으로 키운 뒤, FHD(1920×1080)에서
// 좌측 리스트 영역(~1012px)에 카드(~91px)가 내부 스크롤 없이 꽉 차는 10개로 실측해 맞춤.
export const PRODUCTS_PAGE_SIZE = 10
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

  // 일반 상품만 페이지네이션 (고정 상품은 항상 상단 노출).
  const [page, setPage] = useState(1)

  // 필터/검색이 바뀌면 1페이지로 리셋 (렌더 중 상태 조정 — React 권장 패턴).
  const filterKey = `${productQuery}|${selectedBrandId ?? ''}|${selectedGroupId ?? ''}`
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(normalProducts.length / PRODUCTS_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedNormalProducts = useMemo(
    () =>
      normalProducts.slice(
        (currentPage - 1) * PRODUCTS_PAGE_SIZE,
        currentPage * PRODUCTS_PAGE_SIZE
      ),
    [normalProducts, currentPage]
  )

  if (collapsed) {
    return (
      <div className="h-full">
        {/* lg+: 테이블 좌측 가장자리에 붙는 얇은 세로 탭 */}
        <div className="hidden h-full items-center lg:flex">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={onToggleCollapsed}
                aria-label="상품 목록 열기"
                className="h-20 w-7 rounded-md text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">상품 목록 열기</TooltipContent>
          </Tooltip>
        </div>
        {/* 좁은 화면(세로 스택): 가로 펼치기 바 */}
        <Button
          variant="outline"
          onClick={onToggleCollapsed}
          aria-label="상품 목록 열기"
          className="flex w-full items-center justify-center gap-1.5 lg:hidden"
        >
          <ChevronRight className="h-4 w-4" />
          상품 목록 열기
        </Button>
      </div>
    )
  }

  return (
    <Card className="flex h-full max-h-[480px] min-h-0 flex-col overflow-hidden lg:max-h-none">
      <CardHeader className="gap-3 border-b">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">상품</CardTitle>
            <Badge variant="outline" className="rounded-full text-[11px] font-medium">
              {products.length}개
            </Badge>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onToggleCollapsed}
                aria-label="상품 목록 접기"
                className="text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">상품 목록 접기</TooltipContent>
          </Tooltip>
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
              {pagedNormalProducts.map((product) => (
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {currentPage} / {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="xs"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              이전
            </Button>
            <Button
              variant="outline"
              size="xs"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              다음
            </Button>
          </div>
        </div>
      )}
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
            <div className="truncate text-sm font-medium">{stockStatusDisplayName(product)}</div>
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
