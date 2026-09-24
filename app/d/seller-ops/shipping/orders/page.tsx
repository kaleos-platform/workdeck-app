'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BatchList } from '@/components/sh/shipping/batch-list'
import { OrderDetailTable } from '@/components/sh/shipping/order-detail-table'
import { OrderSearchBar } from '@/components/sh/shipping/order-search-bar'
import { OrderSearchResults } from '@/components/sh/shipping/order-search-results'
import { getDaysAgoStrKst, getTodayStrKst } from '@/lib/date-range'
import { cn } from '@/lib/utils'

type ShippingMethod = { id: string; name: string; defaultSplitMode?: 'order' | 'option' }
type Channel = { id: string; name: string }

// 검색 발동 최소 길이 — API의 MIN_QUERY_LENGTH와 일치
const MIN_QUERY_LENGTH = 2
const presets = [
  { key: '7d', label: '7일' },
  { key: '30d', label: '30일' },
  { key: 'thisMonth', label: '이번달' },
  { key: 'lastMonth', label: '지난달' },
] as const
type PeriodPreset = (typeof presets)[number]['key']

function toDateStr(date: Date) {
  return date.toISOString().split('T')[0]
}

export default function ShippingOrdersPage() {
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [batchPanelCollapsed, setBatchPanelCollapsed] = useState(false)
  const collapseButtonRef = useRef<HTMLButtonElement>(null)
  const expandButtonRef = useRef<HTMLButtonElement>(null)
  const focusAfterToggleRef = useRef(false)
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState(() => getDaysAgoStrKst(7))
  const [dateTo, setDateTo] = useState(getTodayStrKst)
  const [activePreset, setActivePreset] = useState<PeriodPreset | null>('7d')

  useEffect(() => {
    fetch('/api/sh/shipping/shipping-methods?isActive=true')
      .then((r) => r.json())
      .then((data) => setShippingMethods(data.methods ?? []))
      .catch(() => {})
    fetch('/api/del/channels?isActive=true')
      .then((r) => r.json())
      .then((data) => setChannels(data.channels ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!focusAfterToggleRef.current) return
    const targetButtonRef = batchPanelCollapsed ? expandButtonRef : collapseButtonRef
    targetButtonRef.current?.focus()
    focusAfterToggleRef.current = false
  }, [batchPanelCollapsed])

  function toggleBatchPanel() {
    focusAfterToggleRef.current = true
    setBatchPanelCollapsed((collapsed) => !collapsed)
  }

  function applyPreset(preset: PeriodPreset) {
    const today = getTodayStrKst()
    const [year, month] = today.split('-').map(Number)
    let from: string
    let to = today

    switch (preset) {
      case '7d':
        from = getDaysAgoStrKst(7)
        break
      case '30d':
        from = getDaysAgoStrKst(30)
        break
      case 'thisMonth':
        from = toDateStr(new Date(Date.UTC(year, month - 1, 1)))
        break
      case 'lastMonth':
        from = toDateStr(new Date(Date.UTC(year, month - 2, 1)))
        to = toDateStr(new Date(Date.UTC(year, month - 1, 0)))
        break
    }

    setDateFrom(from)
    setDateTo(to)
    setActivePreset(preset)
  }

  const isSearching = searchQuery.trim().length >= MIN_QUERY_LENGTH

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">배송 데이터 관리</h1>

      <section
        aria-label="배송 데이터 필터"
        className="flex flex-col gap-2 rounded-lg border bg-card p-3 xl:flex-row xl:items-center"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {presets.map((preset) => (
              <Button
                key={preset.key}
                type="button"
                variant={activePreset === preset.key ? 'default' : 'outline'}
                size="sm"
                className="h-9 px-2 text-xs"
                onClick={() => applyPreset(preset.key)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto">
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value)
                setActivePreset(null)
              }}
              aria-label="배송 묶음 시작일"
              className="h-9 min-w-0 flex-1 px-1 text-xs sm:w-32 sm:flex-none"
            />
            <span className="text-xs text-muted-foreground">–</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value)
                setActivePreset(null)
              }}
              aria-label="배송 묶음 종료일"
              className="h-9 min-w-0 flex-1 px-1 text-xs sm:w-32 sm:flex-none"
            />
          </div>
        </div>
        <div className="w-full min-w-0 xl:ml-auto xl:max-w-md">
          <OrderSearchBar value={searchQuery} onChange={setSearchQuery} />
        </div>
      </section>

      {isSearching ? (
        <OrderSearchResults
          query={searchQuery.trim()}
          shippingMethods={shippingMethods}
          channels={channels}
        />
      ) : (
        <section
          aria-label="배송 데이터 작업 영역"
          className={cn(
            'space-y-4 2xl:grid 2xl:gap-4 2xl:space-y-0',
            batchPanelCollapsed
              ? '2xl:grid-cols-[44px_minmax(0,1fr)]'
              : '2xl:grid-cols-[280px_minmax(0,1fr)]'
          )}
        >
          <div className={cn('rounded-lg border bg-card p-3', batchPanelCollapsed && '2xl:hidden')}>
            <BatchList
              dateFrom={dateFrom}
              dateTo={dateTo}
              onSelect={setSelectedBatchId}
              selectedBatchId={selectedBatchId}
              onCollapse={toggleBatchPanel}
              collapseButtonRef={collapseButtonRef}
            />
          </div>
          {batchPanelCollapsed && (
            <div className="hidden justify-center 2xl:flex">
              <Button
                ref={expandButtonRef}
                variant="outline"
                size="icon"
                onClick={toggleBatchPanel}
                aria-label="배송 묶음 펼치기"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="min-w-0">
            {selectedBatchId ? (
              <OrderDetailTable batchId={selectedBatchId} shippingMethods={shippingMethods} />
            ) : (
              <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
                배송 묶음을 선택하세요
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
