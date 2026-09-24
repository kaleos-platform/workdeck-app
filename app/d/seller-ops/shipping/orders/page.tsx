'use client'

import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BatchList } from '@/components/sh/shipping/batch-list'
import { OrderDetailTable } from '@/components/sh/shipping/order-detail-table'
import { OrderSearchBar } from '@/components/sh/shipping/order-search-bar'
import { OrderSearchResults } from '@/components/sh/shipping/order-search-results'
import { cn } from '@/lib/utils'

type ShippingMethod = { id: string; name: string; defaultSplitMode?: 'order' | 'option' }
type Channel = { id: string; name: string }

// 검색 발동 최소 길이 — API의 MIN_QUERY_LENGTH와 일치
const MIN_QUERY_LENGTH = 2

export default function ShippingOrdersPage() {
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [batchPanelCollapsed, setBatchPanelCollapsed] = useState(false)
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [searchQuery, setSearchQuery] = useState('')

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

  const isSearching = searchQuery.trim().length >= MIN_QUERY_LENGTH

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">배송 데이터 관리</h1>

      <OrderSearchBar value={searchQuery} onChange={setSearchQuery} />

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
              onSelect={setSelectedBatchId}
              selectedBatchId={selectedBatchId}
              onCollapse={() => setBatchPanelCollapsed(true)}
            />
          </div>
          {batchPanelCollapsed && (
            <div className="hidden justify-center 2xl:flex">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setBatchPanelCollapsed(false)}
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
