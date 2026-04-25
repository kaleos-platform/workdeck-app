'use client'

import { useMemo } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  calculateMatrix,
  DISCOUNT_COLUMNS,
  type MatrixInputs,
  type MatrixCell,
} from '@/lib/sh/pricing-matrix-calc'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

type Props = MatrixInputs

// ─── 숫자 포맷 헬퍼 ────────────────────────────────────────────────────────────

function fmt(n: number) {
  return Math.round(n).toLocaleString('ko-KR')
}

function fmtPct(n: number) {
  return (n * 100).toFixed(1) + '%'
}

// ─── 색상 계산 헬퍼 (inline style 사용 — Tailwind JIT 동적 클래스 회피) ─────────

/** 0~1 강도를 emerald rgba로 변환 */
function emeraldBg(intensity: number): string {
  // emerald-100 기준: rgb(209,250,229), 강도에 따라 더 진하게
  const alpha = 0.15 + intensity * 0.5
  return `rgba(16,185,129,${alpha.toFixed(2)})`
}

/** 0~1 강도를 amber rgba로 변환 */
function amberBg(intensity: number): string {
  const alpha = 0.15 + intensity * 0.45
  return `rgba(245,158,11,${alpha.toFixed(2)})`
}

/** 0~1 강도를 rose rgba로 변환 */
function roseBg(intensity: number): string {
  const alpha = 0.2 + intensity * 0.4
  return `rgba(244,63,94,${alpha.toFixed(2)})`
}

/** 값 배열 내에서 해당 값의 상대 강도 (0~1) */
function relativeIntensity(value: number, maxAbs: number): number {
  if (maxAbs === 0) return 0
  return Math.min(1, Math.abs(value) / maxAbs)
}

// ─── 셀 스타일 계산 ────────────────────────────────────────────────────────────

function revenueStyle(cell: MatrixCell, maxRevenue: number): React.CSSProperties {
  const intensity = relativeIntensity(cell.revenue, maxRevenue)
  return { backgroundColor: emeraldBg(intensity * 0.6) }
}

function feeStyle(cell: MatrixCell): React.CSSProperties {
  // 수수료는 매출 대비 비율 — 높을수록 rose
  const ratio = cell.revenue > 0 ? cell.fee / cell.revenue : 0
  const intensity = Math.min(1, ratio * 3) // 0~33%+ 범위를 0~1로
  if (intensity < 0.3) return { backgroundColor: emeraldBg(0.3 - intensity) }
  if (intensity < 0.6) return { backgroundColor: amberBg((intensity - 0.3) * 2) }
  return { backgroundColor: roseBg((intensity - 0.6) * 2.5) }
}

function profitStyle(cell: MatrixCell, maxAbsProfit: number): React.CSSProperties {
  if (cell.netProfit < 0) {
    const intensity = relativeIntensity(cell.netProfit, maxAbsProfit)
    return { backgroundColor: roseBg(0.3 + intensity * 0.5) }
  }
  const intensity = relativeIntensity(cell.netProfit, maxAbsProfit)
  return { backgroundColor: emeraldBg(intensity * 0.7) }
}

function marginStyle(cell: MatrixCell): React.CSSProperties {
  if (cell.tier === 'good') return { backgroundColor: 'rgba(16,185,129,0.18)' }
  if (cell.tier === 'fair') return { backgroundColor: 'rgba(245,158,11,0.18)' }
  return { backgroundColor: 'rgba(244,63,94,0.2)' }
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function PricingMatrix({ option, channel, promotion, globals, thresholds }: Props) {
  const matrix = useMemo(
    () => calculateMatrix({ option, channel, promotion, globals, thresholds }),
    [option, channel, promotion, globals, thresholds]
  )

  const { cells, maxDiscountForMinMargin } = matrix
  // maxDiscountForMinMargin은 할인율(0~0.5) — 해당 컬럼 인덱스로 변환
  const maxDiscountIdx =
    maxDiscountForMinMargin !== null
      ? DISCOUNT_COLUMNS.indexOf(maxDiscountForMinMargin as (typeof DISCOUNT_COLUMNS)[number])
      : null
  const showSet = option.unitsPerSet > 1

  // 절대값 최대값 (색상 강도 기준점)
  const maxRevenue = Math.max(...cells.map((c) => c.revenue), 1)
  const maxAbsProfit = Math.max(...cells.map((c) => Math.abs(c.netProfit)), 1)

  return (
    <TooltipProvider>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs tabular-nums">
          {/* 컬럼 헤더 */}
          <thead>
            <tr>
              {/* 행 레이블 컬럼 */}
              <th className="w-16 border-r border-b px-2 py-1.5 text-left text-[10px] font-medium text-muted-foreground" />
              {DISCOUNT_COLUMNS.map((d, idx) => {
                const isMaxDiscount = idx === maxDiscountIdx
                return (
                  <th
                    key={d}
                    className={cn(
                      'min-w-[68px] border-b px-1.5 py-1.5 text-center text-[10px] font-medium text-muted-foreground',
                      isMaxDiscount &&
                        'border-l-2 border-l-emerald-500 font-semibold text-emerald-700'
                    )}
                  >
                    {d === 0 ? '0%' : `${(d * 100).toFixed(0)}%`}
                    {isMaxDiscount && (
                      <span className="ml-0.5 text-[8px] text-emerald-600">MAX</span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {/* 행 1: 매출이익 */}
            <tr>
              <td className="border-r border-b px-2 py-1.5 text-[10px] font-medium whitespace-nowrap text-muted-foreground">
                매출
              </td>
              {cells.map((cell, idx) => (
                <td
                  key={idx}
                  className={cn(
                    'border-b px-1.5 py-1.5 text-center',
                    idx === maxDiscountIdx && 'border-l-2 border-l-emerald-500'
                  )}
                  style={revenueStyle(cell, maxRevenue)}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="cursor-default">
                        <p className="text-[11px] font-medium">{fmt(cell.revenue)}</p>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <p>매출이익: {fmt(cell.revenue)}원</p>
                      <p className="text-muted-foreground">최종가: {fmt(cell.finalPrice)}원</p>
                    </TooltipContent>
                  </Tooltip>
                </td>
              ))}
            </tr>

            {/* 행 2: 수수료 */}
            <tr>
              <td className="border-r border-b px-2 py-1.5 text-[10px] font-medium whitespace-nowrap text-muted-foreground">
                수수료
              </td>
              {cells.map((cell, idx) => (
                <td
                  key={idx}
                  className={cn(
                    'border-b px-1.5 py-1.5 text-center',
                    idx === maxDiscountIdx && 'border-l-2 border-l-emerald-500'
                  )}
                  style={feeStyle(cell)}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="cursor-default">
                        <p className="text-[11px]">{fmt(cell.fee)}</p>
                        <p className="text-[9px] text-muted-foreground">
                          {cell.revenue > 0 ? fmtPct(cell.fee / cell.revenue) : '—'}
                        </p>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <p>수수료 합계: {fmt(cell.fee)}원</p>
                      <p className="text-muted-foreground">
                        매출 대비 {cell.revenue > 0 ? fmtPct(cell.fee / cell.revenue) : '—'}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </td>
              ))}
            </tr>

            {/* 행 3: 순이익 */}
            <tr>
              <td className="border-r border-b px-2 py-1.5 text-[10px] font-medium whitespace-nowrap text-muted-foreground">
                순이익
              </td>
              {cells.map((cell, idx) => (
                <td
                  key={idx}
                  className={cn(
                    'border-b px-1.5 py-1.5 text-center',
                    idx === maxDiscountIdx && 'border-l-2 border-l-emerald-500'
                  )}
                  style={profitStyle(cell, maxAbsProfit)}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="cursor-default">
                        <p
                          className={cn(
                            'text-[11px] font-semibold',
                            cell.netProfit >= 0 ? 'text-emerald-800' : 'text-rose-700'
                          )}
                        >
                          {fmt(cell.netProfit)}
                        </p>
                        {showSet && (
                          <p className="text-[9px] text-muted-foreground">
                            1개 {fmt(cell.perUnitProfit)}
                          </p>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <p>순이익: {fmt(cell.netProfit)}원</p>
                      {showSet && (
                        <p className="text-muted-foreground">
                          1개당: {fmt(cell.perUnitProfit)}원 ({option.unitsPerSet}개 세트)
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </td>
              ))}
            </tr>

            {/* 행 4: 순이익율 */}
            <tr>
              <td className="border-r px-2 py-1.5 text-[10px] font-medium whitespace-nowrap text-muted-foreground">
                이익율
              </td>
              {cells.map((cell, idx) => (
                <td
                  key={idx}
                  className={cn(
                    'px-1.5 py-1.5 text-center',
                    idx === maxDiscountIdx && 'border-l-2 border-l-emerald-500'
                  )}
                  style={marginStyle(cell)}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="cursor-default">
                        <p
                          className={cn(
                            'text-[11px] font-bold',
                            cell.tier === 'good' && 'text-emerald-800',
                            cell.tier === 'fair' && 'text-amber-800',
                            cell.tier === 'bad' && 'text-rose-700'
                          )}
                        >
                          {fmtPct(cell.margin)}
                        </p>
                        <p className="text-[8px] text-muted-foreground capitalize">{cell.tier}</p>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <p>순이익율: {fmtPct(cell.margin)}</p>
                      <p className="text-muted-foreground">
                        등급:{' '}
                        {cell.tier === 'good'
                          ? '우수 (emerald)'
                          : cell.tier === 'fair'
                            ? '적정 (amber)'
                            : '위험 (rose)'}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  )
}
