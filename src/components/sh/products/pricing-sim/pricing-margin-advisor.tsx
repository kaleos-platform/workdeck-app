'use client'

import { useMemo } from 'react'
import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  calculateMatrix,
  type MatrixChannel,
  type MatrixOption,
  type MatrixPromotion,
  type MatrixGlobals,
} from '@/lib/sh/pricing-matrix-calc'
import type { TierThresholds } from '@/lib/sh/margin-tier'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

type ChannelEntry = {
  key: string
  name: string
  channel: MatrixChannel
}

type Props = {
  option: MatrixOption
  channels: ChannelEntry[]
  promotion: MatrixPromotion
  globals: MatrixGlobals
  thresholds: TierThresholds
}

// ─── 숫자 포맷 헬퍼 ────────────────────────────────────────────────────────────

function fmt(n: number) {
  return Math.round(n).toLocaleString('ko-KR')
}

// ─── 채널 행 ──────────────────────────────────────────────────────────────────

function ChannelAdvisorRow({
  channelEntry,
  option,
  promotion,
  globals,
  thresholds,
}: {
  channelEntry: ChannelEntry
  option: MatrixOption
  promotion: MatrixPromotion
  globals: MatrixGlobals
  thresholds: TierThresholds
}) {
  const result = useMemo(
    () =>
      calculateMatrix({
        option,
        channel: channelEntry.channel,
        promotion,
        globals,
        thresholds,
      }),
    [option, channelEntry.channel, promotion, globals, thresholds]
  )

  const { recommendedRetailForGoodMargin, maxDiscountForMinMargin } = result
  const minMarginPct = (globals.minimumAcceptableMargin * 100).toFixed(0)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
      {/* 채널명 */}
      <span className="min-w-[80px] font-medium text-foreground/80">{channelEntry.name}</span>

      {/* 권장 소매가 */}
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">목표 마진 권장가</span>
        {recommendedRetailForGoodMargin !== null ? (
          <span className="font-semibold text-emerald-700">
            {fmt(recommendedRetailForGoodMargin)}원
          </span>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex cursor-default items-center gap-0.5 text-rose-600">
                  달성 불가
                  <Info className="h-3 w-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[220px] text-xs">
                수수료·운영비·광고비 합계가 너무 높아 목표 마진을 구조적으로 달성할 수 없습니다.
                설정에서 비용 비율을 낮추거나 목표 마진을 조정하세요.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* 최대 할인 가능률 */}
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">최대 할인</span>
        {maxDiscountForMinMargin !== null ? (
          <span className="font-semibold text-amber-700">
            {(maxDiscountForMinMargin * 100).toFixed(0)}%
          </span>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex cursor-default items-center gap-0.5 text-rose-600">
                  할인 여력 없음
                  <Info className="h-3 w-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[220px] text-xs">
                0% 할인에서도 최소 허용 마진({minMarginPct}%)을 달성하지 못합니다. 공급가·수수료를
                확인하세요.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <span className="text-[10px] text-muted-foreground">(최소 {minMarginPct}% 마진 유지)</span>
      </div>
    </div>
  )
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function PricingMarginAdvisor({ option, channels, promotion, globals, thresholds }: Props) {
  if (channels.length === 0) return null
  if (option.retailPrice <= 0 || option.costPrice <= 0) return null

  return (
    <div className="rounded-md border border-dashed border-amber-200 bg-amber-50/40 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
        <Info className="h-3.5 w-3.5" />
        마진 어드바이저
      </div>
      <div className="space-y-1.5">
        {channels.map((ch) => (
          <ChannelAdvisorRow
            key={ch.key}
            channelEntry={ch}
            option={option}
            promotion={promotion}
            globals={globals}
            thresholds={thresholds}
          />
        ))}
      </div>
    </div>
  )
}

export type { ChannelEntry as AdvisorChannelEntry }
