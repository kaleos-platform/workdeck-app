'use client'

import { useMemo } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { MatrixCell } from '@/lib/sh/pricing-matrix-calc'

// ─── 세그먼트 정의 ───────────────────────────────────────────────────────────
// 가로 스택바 — 판매가(finalPrice)를 100%로 보고 비용·마진 구성을 폭 비율로 분해.
// 색상은 스크린샷 시안 팔레트. 마진이 음수면 별도 처리.

type SegmentKey =
  | 'cogs'
  | 'channelFee'
  | 'adCost'
  | 'shipping'
  | 'returnCost'
  | 'packaging'
  | 'paymentFee'
  | 'vat'
  | 'margin'

type SegmentDef = {
  key: SegmentKey
  label: string
  /** 막대 채움 색 (인라인 — Tailwind JIT 동적 클래스 회피) */
  color: string
}

// 표시 순서 = 레전드 순서.
// 색은 seller-ops 컨벤션 따름: 원가=slate(중립), 비용군=amber 그라데이션(비용=amber),
// VAT=slate 연회색(세금=중립), 마진=emerald(success). emerald/amber/slate 3색계.
const SEGMENTS: SegmentDef[] = [
  { key: 'cogs', label: '원가', color: '#334155' }, // slate-700 (원가 = 큰 중립 덩어리)
  { key: 'channelFee', label: '채널수수료', color: '#b45309' }, // amber-700
  { key: 'adCost', label: '광고비', color: '#d97706' }, // amber-600
  { key: 'shipping', label: '물류', color: '#f59e0b' }, // amber-500
  { key: 'returnCost', label: '반품', color: '#fbbf24' }, // amber-400
  { key: 'packaging', label: '포장', color: '#fcd34d' }, // amber-300
  { key: 'paymentFee', label: 'PG', color: '#fde68a' }, // amber-200
  { key: 'vat', label: 'VAT', color: '#cbd5e1' }, // slate-300 (세금 = 중립 회색)
  { key: 'margin', label: '마진', color: '#10b981' }, // emerald-500 (마진 = success)
]

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

// ─── 컴포넌트 ────────────────────────────────────────────────────────────────

type Props = {
  /** 권장가(또는 현재 판매가) 0% 할인 셀 */
  cell: MatrixCell
  /** 레전드 표시 여부 (기본 true) */
  showLegend?: boolean
}

/**
 * 판매가 구성 가로 스택바.
 * 원가/수수료/광고/물류/반품/PG/VAT/마진을 finalPrice 대비 폭 %로 표현.
 * 마진이 음수면 마진 세그먼트는 폭 0, 막대 끝에 적자 표시.
 */
export function PricingCostBar({ cell, showLegend = true }: Props) {
  const { base, segments } = useMemo(() => {
    const values: Record<SegmentKey, number> = {
      cogs: cell.cogs,
      channelFee: cell.channelFee,
      adCost: cell.adCost,
      shipping: cell.shipping,
      returnCost: cell.returnCost,
      packaging: cell.packaging,
      paymentFee: cell.paymentFee,
      vat: cell.vat,
      margin: Math.max(0, cell.netProfit),
    }
    // 폭 분모 = 비용 합 + 양(+)마진 + VAT (= finalPrice 근사). 0 방지.
    const total = Math.max(
      1,
      SEGMENTS.reduce((s, d) => s + Math.max(0, values[d.key]), 0)
    )
    return {
      base: cell.finalPrice,
      segments: SEGMENTS.map((d) => ({
        ...d,
        value: values[d.key],
        widthPct: (Math.max(0, values[d.key]) / total) * 100,
      })),
    }
  }, [cell])

  const loss = cell.netProfit < 0

  return (
    <div className="space-y-2">
      {/* 스택 막대 — 세그먼트 hover 시 상세(항목·금액·판매가 대비 비율) */}
      <TooltipProvider>
        <div className="flex h-6 w-full overflow-hidden rounded-md">
          {segments.map((s) => {
            if (s.widthPct <= 0) return null
            const isMargin = s.key === 'margin'
            const amount = isMargin ? cell.netProfit : s.value
            const pct = base > 0 ? (s.value / base) * 100 : 0
            return (
              <Tooltip key={s.key}>
                <TooltipTrigger asChild>
                  <div
                    className="h-full cursor-default"
                    style={{ width: `${s.widthPct}%`, backgroundColor: s.color }}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <div className="flex items-center gap-1.5 font-medium">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-[2px]"
                      style={{ backgroundColor: s.color }}
                      aria-hidden
                    />
                    {s.label}
                  </div>
                  <p className="tabular-nums">₩{fmt(amount)}</p>
                  <p className="text-muted-foreground tabular-nums">
                    판매가 대비 {pct.toFixed(1)}%
                  </p>
                  {isMargin && (
                    <p className="text-muted-foreground tabular-nums">
                      이익율 {(cell.margin * 100).toFixed(1)}%
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            )
          })}
          {loss && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex h-full flex-1 cursor-default items-center justify-end bg-destructive/15 px-1.5 text-[10px] font-semibold text-destructive">
                  적자
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p className="font-medium text-destructive">적자</p>
                <p className="tabular-nums">₩{fmt(cell.netProfit)}</p>
                <p className="text-muted-foreground tabular-nums">
                  이익율 {(cell.margin * 100).toFixed(1)}%
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>

      {/* 레전드 — 값·판매가 대비 비율 동반 */}
      {showLegend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {segments.map((s) => {
            // 모든 항목 판매가(결제금액) 대비 비율 표기 — 스택바 폭 기준과 동일. 마진 포함.
            const amount = s.key === 'margin' ? cell.netProfit : s.value
            const pct = base > 0 ? Math.round((amount / base) * 100) : null
            return (
              <span key={s.key} className="inline-flex items-center gap-1.5 tabular-nums">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="text-muted-foreground">{s.label}</span>{' '}
                <span
                  className={
                    s.key === 'margin' && !loss
                      ? 'font-semibold text-emerald-700'
                      : 'font-medium text-foreground'
                  }
                >
                  ₩{fmt(amount)}
                </span>
                {pct != null && <span className="text-muted-foreground">({pct}%)</span>}
              </span>
            )
          })}
          <span className="ml-auto inline-flex items-center gap-1.5 tabular-nums">
            판매가 <span className="font-semibold text-foreground">₩{fmt(base)}</span>
          </span>
        </div>
      )}
    </div>
  )
}
