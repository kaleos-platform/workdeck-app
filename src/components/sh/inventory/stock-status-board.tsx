'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { StockStatusHeader } from './stock-status-header'
import { StockStatusLocationTabs } from './stock-status-location-tabs'
import { StockStatusProducts } from './stock-status-products'
import { StockStatusToolbar } from './stock-status-toolbar'
import { StockStatusMatrix } from './stock-status-matrix'
import type { StockStatusResponse } from './stock-status.types'
import {
  buildStockStatusProducts,
  filterStockStatusProducts,
  scopeStockStatusRows,
} from './stock-status-view-model'

const PINNED_PRODUCTS_STORAGE_KEY = 'workdeck.stock-status.pinned-products'

export function StockStatusBoard() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const brandId = searchParams.get('brandId')
  const groupId = searchParams.get('groupId')
  const productId = searchParams.get('productId')
  const locationId = searchParams.get('locationId')
  const q = searchParams.get('q') ?? ''
  const onlyLow = searchParams.get('onlyLow') === '1'

  const [data, setData] = useState<StockStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [productQuery, setProductQuery] = useState('')
  const [productsCollapsed, setProductsCollapsed] = useState(false)
  const [pinnedProductIds, setPinnedProductIds] = useState<string[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const res = await fetch('/api/sh/inventory/stock-status', {
        signal: controller.signal,
      })
      if (!res.ok) throw new Error('재고 데이터를 불러오지 못했습니다')
      const json = (await res.json()) as StockStatusResponse
      setData(json)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      console.error(err)
      toast.error('재고 데이터를 불러오지 못했습니다')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PINNED_PRODUCTS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setPinnedProductIds(parsed.filter((item): item is string => typeof item === 'string'))
      }
    } catch {
      setPinnedProductIds([])
    }
  }, [])

  const updateParams = useCallback(
    (mut: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [k, v] of Object.entries(mut)) {
        if (v === null || v === '') next.delete(k)
        else next.set(k, v)
      }
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams]
  )

  const handleSearchChange = useCallback(
    (newQ: string) => updateParams({ q: newQ || null }),
    [updateParams]
  )

  const handleOnlyLowChange = useCallback(
    (v: boolean) => updateParams({ onlyLow: v ? '1' : null }),
    [updateParams]
  )

  // 브랜드 변경 시 groupId도 함께 클리어 (다른 브랜드 소속일 수 있음)
  const handleBrandChange = useCallback(
    (newBrandId: string | null) =>
      updateParams({ brandId: newBrandId, groupId: null, productId: null }),
    [updateParams]
  )

  const handleGroupChange = useCallback(
    (newGroupId: string | null) => updateParams({ groupId: newGroupId, productId: null }),
    [updateParams]
  )

  const handleLocationChange = useCallback(
    (newLocationId: string | null) => updateParams({ locationId: newLocationId }),
    [updateParams]
  )

  const handleClearFilters = useCallback(() => {
    setProductQuery('')
    updateParams({
      brandId: null,
      groupId: null,
      productId: null,
      locationId: null,
      q: null,
      onlyLow: null,
    })
  }, [updateParams])

  const handleProductSelect = useCallback(
    (newProductId: string | null) => updateParams({ productId: newProductId }),
    [updateParams]
  )

  const handleProductPinToggle = useCallback((targetProductId: string) => {
    setPinnedProductIds((current) => {
      const next = current.includes(targetProductId)
        ? current.filter((id) => id !== targetProductId)
        : [targetProductId, ...current]
      window.localStorage.setItem(PINNED_PRODUCTS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const allRows = useMemo(() => data?.matrix.rows ?? [], [data?.matrix.rows])
  const scopedRows = useMemo(() => scopeStockStatusRows(allRows, locationId), [allRows, locationId])

  const products = useMemo(
    () => buildStockStatusProducts(allRows, locationId),
    [allRows, locationId]
  )

  const visibleProducts = useMemo(
    () =>
      filterStockStatusProducts(products, {
        brandId,
        groupId,
        pinnedProductIds,
        query: productQuery,
      }),
    [brandId, groupId, pinnedProductIds, productQuery, products]
  )

  // 상품별 보기만 지원: 선택이 없거나(초기/필터 변경) 현재 목록에 없으면 첫 상품으로 폴백.
  // URL은 오염하지 않고(effect 없이) 화면에서만 유효한 한 상품을 표시한다.
  const effectiveProductId = useMemo(() => {
    if (productId && visibleProducts.some((p) => p.productId === productId)) {
      return productId
    }
    return visibleProducts[0]?.productId ?? null
  }, [productId, visibleProducts])

  const visibleRows = useMemo(() => {
    const optionQuery = q.trim().toLowerCase()
    return scopedRows.filter((row) => {
      if (effectiveProductId && row.productId !== effectiveProductId) return false
      if (onlyLow && row.displayStatus !== 'LOW' && row.displayStatus !== 'OUT') return false
      if (!optionQuery) return true
      return [
        row.optionName,
        row.sku ?? '',
        row.productName,
        row.productInternalName ?? '',
        ...Object.values(row.externalCodeByLocation),
      ].some((value) => value.toLowerCase().includes(optionQuery))
    })
  }, [onlyLow, effectiveProductId, q, scopedRows])

  const selectedProductName = useMemo(
    () => products.find((product) => product.productId === effectiveProductId)?.productName ?? null,
    [effectiveProductId, products]
  )

  return (
    <div className="space-y-5">
      <StockStatusHeader loading={loading} onRefresh={fetchData} />

      <StockStatusLocationTabs
        locations={data?.locations ?? []}
        selectedLocationId={locationId}
        onLocationChange={handleLocationChange}
      />

      <div
        className={[
          'grid grid-cols-1 items-stretch gap-4',
          productsCollapsed
            ? 'lg:grid-cols-[28px_minmax(0,1fr)]'
            : 'lg:grid-cols-[360px_minmax(0,1fr)]',
          'lg:h-[calc(140vh-13rem)]',
        ].join(' ')}
      >
        <StockStatusProducts
          products={visibleProducts}
          brands={data?.brands ?? []}
          loading={loading && !data}
          selectedProductId={effectiveProductId}
          selectedBrandId={brandId}
          selectedGroupId={groupId}
          productQuery={productQuery}
          pinnedProductIds={pinnedProductIds}
          collapsed={productsCollapsed}
          onSelectProduct={handleProductSelect}
          onToggleCollapsed={() => setProductsCollapsed((current) => !current)}
          onTogglePinned={handleProductPinToggle}
          onBrandChange={handleBrandChange}
          onGroupChange={handleGroupChange}
          onSearchChange={setProductQuery}
        />

        <div className="min-h-0 min-w-0">
          <div className="flex h-full max-h-[60vh] min-h-0 flex-col gap-3 lg:max-h-none">
            <StockStatusMatrix
              rows={visibleRows}
              locations={data?.locations ?? []}
              loading={loading && !data}
              selectedLocationId={locationId}
              selectedProductName={selectedProductName}
              toolbar={
                <StockStatusToolbar
                  q={q}
                  onlyLow={onlyLow}
                  onSearchChange={handleSearchChange}
                  onOnlyLowChange={handleOnlyLowChange}
                  onClearFilters={handleClearFilters}
                />
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}
