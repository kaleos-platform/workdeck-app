'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StockStatusHeader } from './stock-status-header'
import { StockStatusKpis } from './stock-status-kpis'
import { StockStatusLocations } from './stock-status-locations'
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
  const locationId = searchParams.get('locationId')
  const q = searchParams.get('q') ?? ''
  const onlyLow = searchParams.get('onlyLow') === '1'

  const [data, setData] = useState<StockStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  // 매트릭스 섹션 ref — 드릴다운 시 스크롤 타겟
  const matrixRef = useRef<HTMLDivElement>(null)

  const fetchData = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (brandId) params.set('brandId', brandId)
      if (groupId) params.set('groupId', groupId)
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
  }, [brandId, groupId, q, onlyLow])

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
    (newBrandId: string | null) => updateParams({ brandId: newBrandId, groupId: null }),
    [updateParams]
  )

  const handleGroupChange = useCallback(
    (newGroupId: string | null) => updateParams({ groupId: newGroupId }),
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
        locationId: null,
        q: null,
        onlyLow: null,
      }),
    [updateParams]
  )

  // 매트릭스로 부드럽게 스크롤 — DOM 업데이트 후 실행
  const scrollToMatrix = useCallback(() => {
    requestAnimationFrame(() => {
      matrixRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  // 상품명으로 매트릭스 필터 (q 파라미터 재사용) + 자동 스크롤
  const handleProductSelect = useCallback(
    (productName: string) => {
      updateParams({ q: productName })
      scrollToMatrix()
    },
    [updateParams, scrollToMatrix]
  )

  // 위치 도넛에서 드릴다운 + 자동 스크롤
  const handleViewLocationDetail = useCallback(
    (locId: string) => {
      handleLocationChange(locId)
      scrollToMatrix()
    },
    [handleLocationChange, scrollToMatrix]
  )

  // 매트릭스 드릴다운 필터만 클리어 (locationId + q)
  const handleClearDrilldown = useCallback(
    () => updateParams({ locationId: null, q: null }),
    [updateParams]
  )

  const allRows = data?.matrix.rows ?? []
  const visibleRows = locationId
    ? allRows.filter((r) => r.byLocation[locationId] !== undefined)
    : allRows

  // 드릴다운 필터 활성 여부 — locationId 또는 q 중 하나라도 있으면
  const hasDrilldown = !!(locationId || q)
  // 활성 드릴다운 레이블 — 위치명 우선, 없으면 검색어
  const drilldownLabel = locationId
    ? (data?.locations.find((l) => l.id === locationId)?.name ?? locationId)
    : q

  return (
    <div className="space-y-5">
      <StockStatusHeader loading={loading} onRefresh={fetchData} />

      {/* KPI(좌) + 위치 분포 도넛(우) 나란히 배치 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StockStatusKpis kpis={data?.kpis ?? null} />
        <StockStatusLocations
          locations={data?.locations ?? []}
          loading={loading && !data}
          onViewLocationDetail={handleViewLocationDetail}
        />
      </div>

      {/* 상품별 재고 요약 */}
      <StockStatusProducts
        products={data?.products ?? []}
        loading={loading && !data}
        onSelectProduct={handleProductSelect}
      />

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

      {/* 매트릭스 섹션 — ref 부착 + scroll-mt로 sticky 헤더 보정 */}
      <div ref={matrixRef} className="scroll-mt-24">
        {/* 드릴다운 활성 시 sticky 필터바 */}
        {hasDrilldown && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
            <span className="text-xs text-muted-foreground">현재 보는 중:</span>
            <Badge variant="secondary" className="text-xs">
              {drilldownLabel}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 px-2 text-xs"
              onClick={handleClearDrilldown}
            >
              <X className="mr-1 h-3 w-3" />
              전체 보기
            </Button>
          </div>
        )}

        <StockStatusMatrix
          rows={visibleRows}
          locations={data?.locations ?? []}
          loading={loading && !data}
          selectedLocationId={locationId}
        />
      </div>
    </div>
  )
}
