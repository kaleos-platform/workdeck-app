'use client'

import { useEffect, useState } from 'react'
import { Minus } from 'lucide-react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type ScenarioSummary = {
  id: string
  name: string
  channel: { id: string; name: string } | null
}

type ScenarioItem = {
  id: string
  optionId: string
  finalPrice: number
  salePrice: number
  discountRate: number
  netProfit: number
  margin: number
  option: {
    id: string
    name: string
    product: { id: string; name: string }
  }
}

type ScenarioDetail = {
  id: string
  name: string
  channel: { id: string; name: string } | null
  totalNetProfit: number
  averageMargin: number
  items: ScenarioItem[]
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  scenarios: ScenarioSummary[]
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

const krw = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
})

function fmt(n: number) {
  return krw.format(Math.round(n))
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

// ─── 단일 시나리오 카드 ────────────────────────────────────────────────────────

function ScenarioCard({
  side,
  detail,
  otherDetail,
}: {
  side: 'left' | 'right'
  detail: ScenarioDetail
  otherDetail: ScenarioDetail | null
}) {
  // 양쪽 optionId 합집합으로 행 생성
  const allOptionIds = Array.from(
    new Set([
      ...detail.items.map((it) => it.optionId),
      ...(otherDetail?.items.map((it) => it.optionId) ?? []),
    ])
  )

  const itemMap = new Map(detail.items.map((it) => [it.optionId, it]))
  const otherMap = new Map(otherDetail?.items.map((it) => [it.optionId, it]) ?? [])

  // 옵션 이름은 양쪽 중 있는 쪽에서 가져옴
  function getOptionName(optionId: string) {
    return itemMap.get(optionId)?.option.name ?? otherMap.get(optionId)?.option.name ?? optionId
  }

  function getProductName(optionId: string) {
    return (
      itemMap.get(optionId)?.option.product.name ??
      otherMap.get(optionId)?.option.product.name ??
      ''
    )
  }

  return (
    <div className="min-w-0 flex-1 rounded-lg border bg-card">
      {/* 카드 헤더 */}
      <div className="border-b px-4 py-3">
        <p className="truncate text-base font-semibold">{detail.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {detail.channel?.name ?? '채널 미지정'}
        </p>
        <div className="mt-2 flex gap-4 text-sm">
          <span>
            순수익{' '}
            <span
              className={cn(
                'font-semibold',
                detail.totalNetProfit >= 0 ? 'text-green-600' : 'text-destructive'
              )}
            >
              {fmt(detail.totalNetProfit)}
            </span>
          </span>
          <span>
            평균마진 <span className="font-semibold">{pct(detail.averageMargin)}</span>
          </span>
        </div>
      </div>

      {/* 옵션 행 */}
      <div className="divide-y">
        {allOptionIds.map((optionId) => {
          const mine = itemMap.get(optionId)
          const other = otherMap.get(optionId)

          // 비교: 우측이 기준 (right가 더 좋으면 emerald, 더 나쁘면 rose)
          let rowBg = ''
          if (side === 'right' && mine && other) {
            if (mine.netProfit > other.netProfit) rowBg = 'bg-emerald-50'
            else if (mine.netProfit < other.netProfit) rowBg = 'bg-rose-50'
          }

          return (
            <div key={optionId} className={cn('px-4 py-2.5 text-xs', rowBg)}>
              {mine ? (
                <>
                  <p className="truncate text-sm font-medium">{getOptionName(optionId)}</p>
                  <p className="truncate text-muted-foreground">{getProductName(optionId)}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>판매가 {fmt(mine.finalPrice)}</span>
                    <span>할인 {pct(mine.discountRate)}</span>
                    <span
                      className={cn(
                        'font-medium',
                        mine.netProfit >= 0 ? 'text-green-600' : 'text-destructive'
                      )}
                    >
                      순수익 {fmt(mine.netProfit)}
                    </span>
                    <span>마진 {pct(mine.margin)}</span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground/50">
                  <Minus className="h-3 w-3" />
                  <span className="truncate">{getOptionName(optionId)}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 메인 다이얼로그 ──────────────────────────────────────────────────────────

export function PricingComparisonDialog({ open, onOpenChange, scenarios }: Props) {
  const [leftId, setLeftId] = useState<string>('')
  const [rightId, setRightId] = useState<string>('')
  const [leftDetail, setLeftDetail] = useState<ScenarioDetail | null>(null)
  const [rightDetail, setRightDetail] = useState<ScenarioDetail | null>(null)
  const [leftLoading, setLeftLoading] = useState(false)
  const [rightLoading, setRightLoading] = useState(false)

  // 좌측 시나리오 fetch
  useEffect(() => {
    if (!leftId) {
      Promise.resolve().then(() => setLeftDetail(null))
      return
    }
    let cancelled = false
    Promise.resolve().then(() => setLeftLoading(true))
    fetch(`/api/sh/pricing-scenarios/${leftId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setLeftDetail(d)
      })
      .catch(() => {
        if (!cancelled) setLeftDetail(null)
      })
      .finally(() => {
        if (!cancelled) setLeftLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leftId])

  // 우측 시나리오 fetch
  useEffect(() => {
    if (!rightId) {
      Promise.resolve().then(() => setRightDetail(null))
      return
    }
    let cancelled = false
    Promise.resolve().then(() => setRightLoading(true))
    fetch(`/api/sh/pricing-scenarios/${rightId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setRightDetail(d)
      })
      .catch(() => {
        if (!cancelled) setRightDetail(null)
      })
      .finally(() => {
        if (!cancelled) setRightLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [rightId])

  // 다이얼로그 닫힐 때 리셋
  useEffect(() => {
    if (!open) {
      Promise.resolve().then(() => {
        setLeftId('')
        setRightId('')
        setLeftDetail(null)
        setRightDetail(null)
      })
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>시나리오 비교</DialogTitle>
        </DialogHeader>

        {/* 시나리오 선택 셀렉터 */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">비교 대상 A</p>
            <Select
              value={leftId || '__none__'}
              onValueChange={(v) => setLeftId(v === '__none__' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="시나리오 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">선택 안 함</SelectItem>
                {scenarios.map((s) => (
                  <SelectItem key={s.id} value={s.id} disabled={s.id === rightId}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">비교 대상 B (기준)</p>
            <Select
              value={rightId || '__none__'}
              onValueChange={(v) => setRightId(v === '__none__' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="시나리오 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">선택 안 함</SelectItem>
                {scenarios.map((s) => (
                  <SelectItem key={s.id} value={s.id} disabled={s.id === leftId}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 비교 본문 */}
        <div className="mt-2 flex-1 overflow-y-auto">
          {!leftId && !rightId ? (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
              시나리오를 선택하면 옵션별 결과를 비교합니다
            </div>
          ) : (
            <div className="flex gap-4">
              {/* 좌측 */}
              <div className="min-w-0 flex-1">
                {leftLoading ? (
                  <div className="flex h-40 items-center justify-center rounded-lg border text-sm text-muted-foreground">
                    불러오는 중...
                  </div>
                ) : leftDetail ? (
                  <ScenarioCard side="left" detail={leftDetail} otherDetail={rightDetail} />
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                    A 시나리오를 선택하세요
                  </div>
                )}
              </div>

              {/* 우측 */}
              <div className="min-w-0 flex-1">
                {rightLoading ? (
                  <div className="flex h-40 items-center justify-center rounded-lg border text-sm text-muted-foreground">
                    불러오는 중...
                  </div>
                ) : rightDetail ? (
                  <ScenarioCard side="right" detail={rightDetail} otherDetail={leftDetail} />
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                    B 시나리오를 선택하세요
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
