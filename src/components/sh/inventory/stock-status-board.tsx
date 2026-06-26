'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { StockStatusHeader } from './stock-status-header'
import { StockStatusProducts } from './stock-status-products'
import { StockStatusToolbar } from './stock-status-toolbar'
import { StockStatusMatrix } from './stock-status-matrix'
import type { StockStatusResponse } from './stock-status.types'

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
  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (brandId) params.set('brandId', brandId)
      if (groupId) params.set('groupId', groupId)
      if (productId) params.set('productId', productId)
      if (q) params.set('q', q)
      if (onlyLow) params.set('onlyLow', '1')
      const qs = params.toString()
      const res = await fetch(`/api/sh/inventory/stock-status${qs ? `?${qs}` : ''}`, {
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
  }, [brandId, groupId, productId, q, onlyLow])

  useEffect(() => {
    fetchData()
  }, [fetchData])

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

  const handleClearFilters = useCallback(
    () =>
      updateParams({
        brandId: null,
        groupId: null,
        productId: null,
        locationId: null,
        q: null,
        onlyLow: null,
      }),
    [updateParams]
  )

  const handleProductSelect = useCallback(
    (newProductId: string | null) => updateParams({ productId: newProductId }),
    [updateParams]
  )

  const allRows = data?.matrix.rows ?? []
  const visibleRows = locationId
    ? allRows.filter((r) => r.byLocation[locationId] !== undefined)
    : allRows

  const selectedProductName = useMemo(
    () => data?.products.find((p) => p.productId === productId)?.productName ?? null,
    [data?.products, productId]
  )

  return (
    <div className="space-y-5">
      <StockStatusHeader loading={loading} onRefresh={fetchData} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <StockStatusProducts
          products={data?.products ?? []}
          loading={loading && !data}
          selectedProductId={productId}
          onSelectProduct={handleProductSelect}
        />

        <div className="min-w-0 space-y-3">
          <StockStatusToolbar
            q={q}
            onlyLow={onlyLow}
            brands={data?.brands ?? []}
            locations={data?.locations ?? []}
            selectedBrandId={brandId}
            selectedGroupId={groupId}
            selectedLocationId={locationId}
            onSearchChange={handleSearchChange}
            onOnlyLowChange={handleOnlyLowChange}
            onBrandChange={handleBrandChange}
            onGroupChange={handleGroupChange}
            onLocationChange={handleLocationChange}
            onClearFilters={handleClearFilters}
          />

          <StockStatusMatrix
            rows={visibleRows}
            locations={data?.locations ?? []}
            loading={loading && !data}
            selectedLocationId={locationId}
            selectedProductName={selectedProductName}
          />
        </div>
      </div>
    </div>
  )
}
