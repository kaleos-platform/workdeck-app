'use client'

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { DbChannel } from './pricing-channel-list'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 이미 추가된 채널 id 목록 — 목록에서 제외 */
  excludeIds: string[]
  onPick: (channel: DbChannel) => void
}

// ─── API 응답 채널 타입 (채널 API 응답 형태) ──────────────────────────────────

type ApiChannel = {
  id: string
  name: string
  channelType: string | null
  kind: string | null
  defaultFeePct: string | number | null
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
    channelType: c.channelType,
    kind: c.kind,
    defaultFeePct: c.defaultFeePct != null ? Number(c.defaultFeePct) : null,
    shippingFee: c.shippingFee != null ? Number(c.shippingFee) : null,
    freeShippingThreshold: c.freeShippingThreshold != null ? Number(c.freeShippingThreshold) : null,
    applyAdCost: c.applyAdCost,
    paymentFeeIncluded: c.paymentFeeIncluded,
    paymentFeePct: c.paymentFeePct != null ? Number(c.paymentFeePct) : null,
  }
}

// ─── 채널 타입 배지 (간략) ────────────────────────────────────────────────────

function TypeBadge({ channelType }: { channelType: string | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    SELF_MALL: { label: '자사몰', cls: 'border-blue-400 text-blue-700' },
    OPEN_MARKET: { label: '오픈마켓', cls: 'border-orange-400 text-orange-700' },
    DEPT_STORE: { label: '백화점', cls: 'border-purple-400 text-purple-700' },
    SOCIAL: { label: '소셜', cls: 'border-pink-400 text-pink-700' },
    WHOLESALE: { label: '도매', cls: 'border-teal-400 text-teal-700' },
  }
  const info = channelType
    ? (map[channelType] ?? { label: channelType, cls: 'border-slate-300 text-slate-600' })
    : { label: '기타', cls: 'border-slate-300 text-slate-500' }
  return (
    <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px]', info.cls)}>
      {info.label}
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
          setChannels((d.channels ?? []).map(toDbChannel))
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
                  <TypeBadge channelType={ch.channelType} />
                </div>
                <div className="mt-0.5 flex gap-x-3 text-[11px] text-muted-foreground">
                  {ch.defaultFeePct != null && (
                    <span>수수료 {(ch.defaultFeePct * 100).toFixed(1)}%</span>
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
