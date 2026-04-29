'use client'

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { lookupCategoryFeePct } from '@/lib/sh/channel-fee-lookup'
import type { DbChannel } from './pricing-channel-list'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 이미 추가된 채널 id 목록 — 목록에서 제외 */
  excludeIds: string[]
  onPick: (channel: DbChannel) => void
}

// ─── API 응답 채널 타입 ────────────────────────────────────────────────────────

type ApiChannel = {
  id: string
  name: string
  channelTypeDef: { id: string; name: string; isSalesChannel: boolean } | null
  useSimulation: boolean
  feeRates: { categoryName: string; ratePercent: string | number }[]
  shippingFee: string | number | null
  freeShippingThreshold: string | number | null
  applyAdCost: boolean
  paymentFeeIncluded: boolean
  paymentFeePct: string | number | null
  isActive: boolean
}

function toDbChannel(c: ApiChannel): DbChannel {
  return {
    id: c.id,
    name: c.name,
    channelTypeDef: c.channelTypeDef,
    useSimulation: c.useSimulation,
    feeRates: (c.feeRates ?? []).map((fr) => ({
      categoryName: fr.categoryName,
      ratePercent: Number(fr.ratePercent),
    })),
    shippingFee: c.shippingFee != null ? Number(c.shippingFee) : null,
    freeShippingThreshold: c.freeShippingThreshold != null ? Number(c.freeShippingThreshold) : null,
    applyAdCost: c.applyAdCost,
    paymentFeeIncluded: c.paymentFeeIncluded,
    paymentFeePct: c.paymentFeePct != null ? Number(c.paymentFeePct) : null,
  }
}

// ─── 채널 유형 배지 ────────────────────────────────────────────────────────────

function TypeBadge({ name }: { name: string | null | undefined }) {
  if (!name) return null
  return (
    <Badge variant="secondary" className={cn('px-1.5 py-0 text-[10px]')}>
      {name}
    </Badge>
  )
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function PricingChannelPickerDialog({ open, onOpenChange, excludeIds, onPick }: Props) {
  const [channels, setChannels] = useState<DbChannel[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')

  // 다이얼로그 열릴 때마다 채널 목록 조회
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const r = await fetch('/api/channels?isActive=true')
        const d: { channels?: ApiChannel[] } = await r.json()
        if (!cancelled) {
          // useSimulation=false 채널은 피커에서 제외 (시뮬레이션 미사용)
          const simulatable = (d.channels ?? []).filter((c) => c.useSimulation !== false)
          setChannels(simulatable.map(toDbChannel))
        }
      } catch {
        if (!cancelled) setChannels([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open])

  const filtered = channels
    .filter((c) => !excludeIds.includes(c.id))
    .filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>채널 선택</DialogTitle>
        </DialogHeader>

        {/* 검색 */}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="채널 검색..."
            className="h-8 pl-8 text-sm"
          />
        </div>

        {/* 채널 목록 */}
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {loading && (
            <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중...</p>
          )}
          {!loading && filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {query ? '검색 결과가 없습니다' : '추가 가능한 채널이 없습니다'}
            </p>
          )}
          {!loading &&
            filtered.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => onPick(ch)}
                className="w-full rounded-md px-3 py-2.5 text-left transition hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{ch.name}</span>
                  <TypeBadge name={ch.channelTypeDef?.name} />
                </div>
                <div className="mt-0.5 flex gap-x-3 text-[11px] text-muted-foreground">
                  {ch.feeRates.length > 0 && (
                    <span>기본 수수료 {(lookupCategoryFeePct(ch.feeRates) * 100).toFixed(1)}%</span>
                  )}
                  {ch.shippingFee != null && (
                    <span>배송비 {Math.round(ch.shippingFee).toLocaleString('ko-KR')}원</span>
                  )}
                  <span>{ch.paymentFeeIncluded ? '결제수수료 포함' : '결제수수료 별도'}</span>
                </div>
              </button>
            ))}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
