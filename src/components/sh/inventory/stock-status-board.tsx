'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { StockStatusHeader } from './stock-status-header'
import { StockStatusLocationTabs } from './stock-status-location-tabs'
import { StockStatusProducts } from './stock-status-products'
import { StockStatusToolbar } from './stock-status-toolbar'
import { StockStatusGradePopover } from './stock-status-grade-popover'
import { StockStatusLocationPicker } from './stock-status-location-picker'
import { StockStatusMatrix } from './stock-status-matrix'
import { StockStatusSummaryBar } from './stock-status-summary'
import { DEFAULT_STOCK_GRADE_SETTINGS } from '@/lib/sh/stock-grade-settings'
import type { StockStatusResponse } from './stock-status.types'
import {
  buildStockStatusProducts,
  filterStockStatusProducts,
  scopeStockStatusRows,
  stockStatusDisplayName,
  summarizeStockStatus,
  type StockStatusSortMode,
} from './stock-status-view-model'

const PINNED_PRODUCTS_STORAGE_KEY = 'workdeck.stock-status.pinned-products'
// 숨긴 위치 ID 를 저장한다(보이는 ID 를 저장하면 새로 만든 위치가 기본 숨김이 된다).
const HIDDEN_LOCATIONS_STORAGE_KEY = 'workdeck.stock-status.hidden-locations'

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
  const [sort, setSort] = useState<StockStatusSortMode>('urgent')
  const [productsCollapsed, setProductsCollapsed] = useState(false)
  const [pinnedProductIds, setPinnedProductIds] = useState<string[]>([])
  const [hiddenLocationIds, setHiddenLocationIds] = useState<string[]>([])
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

  // mount 후에 읽는다 — 렌더 중 localStorage 접근은 SSR 결과와 어긋나 hydration 오류가 난다.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HIDDEN_LOCATIONS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setHiddenLocationIds(parsed.filter((item): item is string => typeof item === 'string'))
      }
    } catch {
      setHiddenLocationIds([])
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
    (newLocationId: string | null) =>
      // 위치 탭에서는 등급을 계산하지 않으므로 onlyLow(조치 필요만)가 남으면 모든 행이 걸러진다.
      updateParams({ locationId: newLocationId, ...(newLocationId ? { onlyLow: null } : {}) }),
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

  const handleToggleLocation = useCallback((locationId: string) => {
    setHiddenLocationIds((current) => {
      const next = current.includes(locationId)
        ? current.filter((id) => id !== locationId)
        : [...current, locationId]
      window.localStorage.setItem(HIDDEN_LOCATIONS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const handleShowAllLocations = useCallback(() => {
    setHiddenLocationIds([])
    window.localStorage.setItem(HIDDEN_LOCATIONS_STORAGE_KEY, JSON.stringify([]))
  }, [])

  const allRows = useMemo(() => data?.matrix.rows ?? [], [data?.matrix.rows])
  // 설정은 재고 응답에 함께 실려 온다 — 따로 fetch 하면 한쪽만 도착한 프레임에 잘못된 등급이 그려진다.
  const gradeSettings = data?.gradeSettings ?? DEFAULT_STOCK_GRADE_SETTINGS
  const scopedRows = useMemo(
    () => scopeStockStatusRows(allRows, locationId, gradeSettings),
    [allRows, locationId, gradeSettings]
  )

  const products = useMemo(
    () => buildStockStatusProducts(allRows, locationId, gradeSettings),
    [allRows, locationId, gradeSettings]
  )

  const visibleProducts = useMemo(
    () =>
      filterStockStatusProducts(products, {
        brandId,
        groupId,
        pinnedProductIds,
        query: productQuery,
        sort,
      }),
    [brandId, groupId, pinnedProductIds, productQuery, products, sort]
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
      if (onlyLow && row.grade !== 'NO_STOCK' && row.grade !== 'RISK') return false
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

  // 상단 요약 — 필터 전 전체 상품 기준(지금 안 보이는 상품의 위험도 알려야 한다)
  const summary = useMemo(() => summarizeStockStatus(products), [products])

  const selectedProduct = useMemo(
    () => products.find((product) => product.productId === effectiveProductId) ?? null,
    [effectiveProductId, products]
  )
  const selectedProductName = selectedProduct ? stockStatusDisplayName(selectedProduct) : null
  const selectedProductOfficialName = selectedProduct?.productName ?? null

  return (
    <div className="space-y-5">
      <StockStatusHeader loading={loading} onRefresh={fetchData} />

      <StockStatusSummaryBar
        summary={summary}
        loading={loading && !data}
        locationScoped={!!locationId}
        onlyLow={onlyLow}
        onOnlyLowChange={handleOnlyLowChange}
      />

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
          // 좌: 상품 목록, 우: 옵션 표 — 둘 다 한 화면에 고정하고 각자 내부 스크롤한다.
          // 페이지 자체는 스크롤되지 않아 목록이 항상 보인다(과거 1.4화면 + 페이지네이션 대체).
          'lg:h-[calc(100vh-13rem)]',
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
          sort={sort}
          pinnedProductIds={pinnedProductIds}
          collapsed={productsCollapsed}
          onSelectProduct={handleProductSelect}
          onToggleCollapsed={() => setProductsCollapsed((current) => !current)}
          onTogglePinned={handleProductPinToggle}
          onBrandChange={handleBrandChange}
          onGroupChange={handleGroupChange}
          onSearchChange={setProductQuery}
          onSortChange={setSort}
        />

        <div className="min-h-0 min-w-0">
          <div className="flex h-full max-h-[60vh] min-h-0 flex-col gap-3 lg:max-h-none">
            <StockStatusMatrix
              rows={visibleRows}
              locations={data?.locations ?? []}
              loading={loading && !data}
              selectedLocationId={locationId}
              selectedProductName={selectedProductName}
              selectedProductOfficialName={selectedProductOfficialName}
              hiddenLocationIds={hiddenLocationIds}
              gradeInfo={<StockStatusGradePopover settings={gradeSettings} onSaved={fetchData} />}
              locationPicker={
                // 위치 탭을 고르면 컬럼이 이미 1개라 선택 UI 가 모순된다.
                locationId ? null : (
                  <StockStatusLocationPicker
                    locations={data?.locations ?? []}
                    hiddenLocationIds={hiddenLocationIds}
                    onToggleLocation={handleToggleLocation}
                    onShowAll={handleShowAllLocations}
                  />
                )
              }
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
