'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { StockStatusHeader } from './stock-status-header'
import { StockStatusKpis } from './stock-status-kpis'
import { StockStatusLocations } from './stock-status-locations'
import { StockStatusTree } from './stock-status-tree'
import { StockStatusToolbar } from './stock-status-toolbar'
import { StockStatusMatrix } from './stock-status-matrix'
import { StockStatusAlerts } from './stock-status-alerts'
import type { StockStatusResponse } from './stock-status.types'

export function StockStatusBoard() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const brandId = searchParams.get('brandId')
  const groupId = searchParams.get('groupId')
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

  const handleTreeSelect = useCallback(
    (next: { brandId?: string | null; groupId?: string | null }) => {
      const target: Record<string, string | null> = {}
      if (next.brandId !== undefined) target.brandId = next.brandId
      if (next.groupId !== undefined) target.groupId = next.groupId
      updateParams(target)
    },
    [updateParams]
  )

  const handleSearchChange = useCallback(
    (newQ: string) => updateParams({ q: newQ || null }),
    [updateParams]
  )

  const handleOnlyLowChange = useCallback(
    (v: boolean) => updateParams({ onlyLow: v ? '1' : null }),
    [updateParams]
  )

  // select에서 브랜드 변경 — 브랜드가 바뀌면 groupId 함께 클리어 (해당 브랜드 소속이 아닐 수 있음)
  const handleBrandChange = useCallback(
    (newBrandId: string | null) => updateParams({ brandId: newBrandId, groupId: null }),
    [updateParams]
  )

  const handleGroupChange = useCallback(
    (newGroupId: string | null) => updateParams({ groupId: newGroupId }),
    [updateParams]
  )

  const handleClearFilters = useCallback(
    () => updateParams({ brandId: null, groupId: null, q: null, onlyLow: null }),
    [updateParams]
  )

  return (
    <div className="space-y-5">
      <StockStatusHeader
        snapshotAt={data?.snapshotAt ?? null}
        loading={loading}
        onRefresh={fetchData}
      />

      <StockStatusKpis kpis={data?.kpis ?? null} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StockStatusLocations locations={data?.locations ?? []} loading={loading && !data} />
        <StockStatusTree
          brands={data?.brands ?? []}
          selectedBrandId={brandId}
          selectedGroupId={groupId}
          onSelect={handleTreeSelect}
          loading={loading && !data}
        />
      </div>

      <StockStatusToolbar
        q={q}
        onlyLow={onlyLow}
        brands={data?.brands ?? []}
        selectedBrandId={brandId}
        selectedGroupId={groupId}
        onSearchChange={handleSearchChange}
        onOnlyLowChange={handleOnlyLowChange}
        onBrandChange={handleBrandChange}
        onGroupChange={handleGroupChange}
        onClearFilters={handleClearFilters}
      />

      <StockStatusMatrix
        rows={data?.matrix.rows ?? []}
        locations={data?.locations ?? []}
        loading={loading && !data}
      />

      <StockStatusAlerts alerts={data?.alerts ?? []} loading={loading && !data} />
    </div>
  )
}
