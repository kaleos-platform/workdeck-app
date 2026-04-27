'use client'

import { useState } from 'react'
import { Plus, X, Edit2, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { PricingChannelInlineForm, type ChannelInlineData } from './pricing-channel-inline-form'
import { PricingChannelPickerDialog } from './pricing-channel-picker-dialog'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

/** DB에서 조회한 채널 전체 데이터 */
export type DbChannel = {
  id: string
  name: string
  channelType: string | null
  kind: string | null
  defaultFeePct: number | null
  shippingFee: number | null
  freeShippingThreshold: number | null
  applyAdCost: boolean
  paymentFeeIncluded: boolean
  paymentFeePct: number | null
}

/** 시나리오 채널 항목 */
export type ScenarioChannel =
  | { source: 'db'; channelId: string; channel: DbChannel }
  | { source: 'inline'; inline: ChannelInlineData }

type Props = {
  channels: ScenarioChannel[]
  /** 이미 추가된 DB 채널 id 목록 (중복 방지용) */
  onChange: (channels: ScenarioChannel[]) => void
  /** 임시 채널이 DB 채널로 등록될 때 — 부모 allDbChannels 캐시 갱신용 */
  onChannelRegistered?: (ch: DbChannel) => void
  /** true이면 Card wrap 없이 fragment로 렌더 (시나리오 카드 내부에 임베드할 때 사용) */
  embedded?: boolean
}

// ─── 채널 타입 레이블 / 배지 ──────────────────────────────────────────────────

function channelTypeBadge(channelType: string | null) {
  if (channelType === 'SELF_MALL') {
    return (
      <Badge variant="outline" className="border-blue-400 px-1.5 py-0 text-[10px] text-blue-700">
        자사몰
      </Badge>
    )
  }
  if (channelType === 'OPEN_MARKET') {
    return (
      <Badge
        variant="outline"
        className="border-orange-400 px-1.5 py-0 text-[10px] text-orange-700"
      >
        오픈마켓
      </Badge>
    )
  }
  if (channelType === 'DEPT_STORE') {
    return (
      <Badge
        variant="outline"
        className="border-purple-400 px-1.5 py-0 text-[10px] text-purple-700"
      >
        백화점
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
      {channelType ?? '기타'}
    </Badge>
  )
}

function paymentFeeLabel(ch: DbChannel | ChannelInlineData) {
  if (ch.paymentFeeIncluded) return '결제수수료 포함'
  const pct = ch.paymentFeePct != null ? (Number(ch.paymentFeePct) * 100).toFixed(1) : '?'
  return `결제수수료 별도 ${pct}%`
}

function fmtWon(n: number | null | undefined) {
  if (n == null) return '—'
  return Math.round(Number(n)).toLocaleString('ko-KR') + '원'
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  return (Number(n) * 100).toFixed(1) + '%'
}

// ─── DB 채널 카드 ─────────────────────────────────────────────────────────────

function DbChannelCard({ ch, onRemove }: { ch: DbChannel; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{ch.name}</span>
          {channelTypeBadge(ch.channelType)}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  'cursor-help px-1.5 py-0 text-[10px]',
                  ch.paymentFeeIncluded
                    ? 'border-slate-300 text-slate-600'
                    : 'border-amber-400 text-amber-700'
                )}
              >
                {paymentFeeLabel(ch)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {ch.paymentFeeIncluded
                ? '채널 수수료에 PG 결제 수수료 포함됨'
                : 'PG 결제 수수료가 별도 차감됩니다'}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>수수료 {fmtPct(ch.defaultFeePct)}</span>
          <span>배송비 {fmtWon(ch.shippingFee)}</span>
          {ch.freeShippingThreshold != null && ch.freeShippingThreshold > 0 && (
            <span>무료배송 {fmtWon(ch.freeShippingThreshold)} 이상</span>
          )}
          <span>광고 {ch.applyAdCost ? 'ON' : 'OFF'}</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label="채널 제거"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// ─── 인라인 채널 카드 ─────────────────────────────────────────────────────────

function InlineChannelCard({
  data,
  onEdit,
  onRemove,
  onPromote,
}: {
  data: ChannelInlineData
  onEdit: () => void
  onRemove: () => void
  /** DB 채널로 등록 완료 시 호출 — 새로 생성된 DbChannel 전달 */
  onPromote: (ch: DbChannel) => void
}) {
  const [promoting, setPromoting] = useState(false)

  async function handlePromote() {
    setPromoting(true)
    try {
      // channelSchema가 요구하는 필드 매핑
      const payload = {
        name: data.name,
        kind:
          data.channelType === 'SELF_MALL'
            ? ('ONLINE_MALL' as const)
            : ('ONLINE_MARKETPLACE' as const),
        channelType: data.channelType === 'SELF_MALL' ? 'SELF_MALL' : 'OTHER',
        isActive: true,
        freeShipping: data.freeShippingThreshold > 0,
        freeShippingThreshold:
          data.freeShippingThreshold > 0 ? data.freeShippingThreshold : undefined,
        // defaultFeePct: 이미 0~1
        defaultFeePct: data.defaultFeePct,
        applyAdCost: data.applyAdCost,
        shippingFee: data.shippingFee,
        paymentFeeIncluded: data.paymentFeeIncluded,
        // paymentFeePct: 이미 0~1
        paymentFeePct: data.paymentFeePct,
      }

      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? '채널 등록 실패')
      }

      const { channel: created } = (await res.json()) as {
        channel: {
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
        }
      }

      // Decimal 필드를 number로 변환
      const dbChannel: DbChannel = {
        id: created.id,
        name: created.name,
        channelType: created.channelType,
        kind: created.kind,
        defaultFeePct: created.defaultFeePct != null ? Number(created.defaultFeePct) : null,
        shippingFee: created.shippingFee != null ? Number(created.shippingFee) : null,
        freeShippingThreshold:
          created.freeShippingThreshold != null ? Number(created.freeShippingThreshold) : null,
        applyAdCost: created.applyAdCost,
        paymentFeeIncluded: created.paymentFeeIncluded,
        paymentFeePct: created.paymentFeePct != null ? Number(created.paymentFeePct) : null,
      }

      toast.success(`채널 "${created.name}" 이(가) 등록되었습니다`)
      onPromote(dbChannel)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '채널 등록 실패')
    } finally {
      setPromoting(false)
    }
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 px-3 py-2.5">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{data.name}</span>
          {channelTypeBadge(data.channelType)}
          <Badge
            variant="outline"
            className="border-slate-300 px-1.5 py-0 text-[10px] text-slate-500"
          >
            임시
          </Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  'cursor-help px-1.5 py-0 text-[10px]',
                  data.paymentFeeIncluded
                    ? 'border-slate-300 text-slate-600'
                    : 'border-amber-400 text-amber-700'
                )}
              >
                {paymentFeeLabel(data)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {data.paymentFeeIncluded
                ? '채널 수수료에 PG 결제 수수료 포함됨'
                : 'PG 결제 수수료가 별도 차감됩니다'}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>수수료 {(data.defaultFeePct * 100).toFixed(1)}%</span>
          <span>배송비 {fmtWon(data.shippingFee)}</span>
          {data.freeShippingThreshold > 0 && (
            <span>무료배송 {fmtWon(data.freeShippingThreshold)} 이상</span>
          )}
          <span>광고 {data.applyAdCost ? 'ON' : 'OFF'}</span>
        </div>
        {/* 채널 등록 버튼 */}
        <button
          type="button"
          disabled={promoting}
          onClick={handlePromote}
          className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {promoting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ExternalLink className="h-3 w-3" />
          )}
          이 설정으로 채널 등록
        </button>
      </div>
      <div className="flex shrink-0 gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={onEdit}
          aria-label="채널 수정"
        >
          <Edit2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="채널 제거"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function PricingChannelList({
  channels,
  onChange,
  onChannelRegistered,
  embedded = false,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [inlineFormOpen, setInlineFormOpen] = useState(false)
  const [editingInlineIdx, setEditingInlineIdx] = useState<number | null>(null)

  const existingDbIds = channels
    .filter((c): c is Extract<ScenarioChannel, { source: 'db' }> => c.source === 'db')
    .map((c) => c.channelId)

  function handleDbPick(ch: DbChannel) {
    onChange([...channels, { source: 'db', channelId: ch.id, channel: ch }])
    setPickerOpen(false)
  }

  function handleInlineConfirm(data: ChannelInlineData) {
    if (editingInlineIdx !== null) {
      // 수정 모드
      const updated = channels.map((c, i) =>
        i === editingInlineIdx && c.source === 'inline' ? { ...c, inline: data } : c
      )
      onChange(updated)
      setEditingInlineIdx(null)
    } else {
      // 추가 모드
      onChange([...channels, { source: 'inline', inline: data }])
    }
  }

  function handleRemove(idx: number) {
    onChange(channels.filter((_, i) => i !== idx))
  }

  function handleEditInline(idx: number) {
    setEditingInlineIdx(idx)
    setInlineFormOpen(true)
  }

  /** 임시 채널 → DB 채널로 승격: 해당 인덱스의 inline 항목을 db 항목으로 교체 */
  function handlePromoteInline(idx: number, dbChannel: DbChannel) {
    const updated = channels.map((c, i) => {
      if (i !== idx || c.source !== 'inline') return c
      return { source: 'db' as const, channelId: dbChannel.id, channel: dbChannel }
    })
    onChange(updated)
    onChannelRegistered?.(dbChannel)
  }

  const editingInlineData =
    editingInlineIdx !== null && channels[editingInlineIdx]?.source === 'inline'
      ? (channels[editingInlineIdx] as Extract<ScenarioChannel, { source: 'inline' }>).inline
      : undefined

  // ── 액션 버튼 (공용) ──
  const actionButtons = (
    <div className="flex gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => setPickerOpen(true)}
      >
        <Plus className="mr-1 h-3 w-3" />
        채널 선택
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => {
          setEditingInlineIdx(null)
          setInlineFormOpen(true)
        }}
      >
        <Plus className="mr-1 h-3 w-3" />
        임시 채널
      </Button>
    </div>
  )

  // ── 채널 목록 (공용) ──
  const channelList = (
    <div className="space-y-2">
      {channels.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          채널을 추가하면 옵션별로 매트릭스가 생성됩니다.
        </p>
      )}
      {channels.map((ch, idx) =>
        ch.source === 'db' ? (
          <DbChannelCard
            key={`db-${ch.channelId}`}
            ch={ch.channel}
            onRemove={() => handleRemove(idx)}
          />
        ) : (
          <InlineChannelCard
            key={`inline-${idx}`}
            data={ch.inline}
            onEdit={() => handleEditInline(idx)}
            onRemove={() => handleRemove(idx)}
            onPromote={(dbCh) => handlePromoteInline(idx, dbCh)}
          />
        )
      )}
    </div>
  )

  // ── 다이얼로그 (공용) ──
  const dialogs = (
    <>
      <PricingChannelPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        excludeIds={existingDbIds}
        onPick={handleDbPick}
      />
      <PricingChannelInlineForm
        open={inlineFormOpen}
        onOpenChange={(v) => {
          setInlineFormOpen(v)
          if (!v) setEditingInlineIdx(null)
        }}
        initialData={editingInlineData}
        onConfirm={handleInlineConfirm}
      />
    </>
  )

  // ── embedded 모드: Card wrap 없이 헤딩 + 콘텐츠만 ──
  if (embedded) {
    return (
      <TooltipProvider>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">채널 ({channels.length}개)</h3>
            {actionButtons}
          </div>
          {channelList}
          {dialogs}
        </div>
      </TooltipProvider>
    )
  }

  // ── 기본 모드: Card wrap 유지 ──
  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">채널 ({channels.length}개)</CardTitle>
            {actionButtons}
          </div>
        </CardHeader>

        <CardContent className="space-y-2">
          {channels.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              채널을 추가하면 옵션별로 매트릭스가 생성됩니다.
            </p>
          )}

          {channels.map((ch, idx) =>
            ch.source === 'db' ? (
              <DbChannelCard
                key={`db-${ch.channelId}`}
                ch={ch.channel}
                onRemove={() => handleRemove(idx)}
              />
            ) : (
              <InlineChannelCard
                key={`inline-${idx}`}
                data={ch.inline}
                onEdit={() => handleEditInline(idx)}
                onRemove={() => handleRemove(idx)}
                onPromote={(dbCh) => handlePromoteInline(idx, dbCh)}
              />
            )
          )}
        </CardContent>
      </Card>

      {dialogs}
    </TooltipProvider>
  )
}
