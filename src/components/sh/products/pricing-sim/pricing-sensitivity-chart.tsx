'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Matrix } from '@/lib/sh/pricing-matrix-calc'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

type Props = {
  /** calculateMatrix()가 반환한 매트릭스 */
  matrix: Matrix
  /** 채널 이름 (차트 제목 표시용, 선택) */
  channelName?: string
}

// ─── 숫자 포맷 헬퍼 ────────────────────────────────────────────────────────────

function fmtWon(n: number) {
  if (Math.abs(n) >= 10000) {
    return `${(n / 10000).toFixed(1)}만`
  }
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

// ─── 커스텀 툴팁 ───────────────────────────────────────────────────────────────

type ChartDatum = {
  discount: string
  discountRate: number
  netProfit: number
  finalPrice: number
  revenue: number
  fee: number
  margin: number
}

function won(n: number) {
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { value: number; payload: ChartDatum }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const profit = d.netProfit
  return (
    <div className="min-w-[168px] space-y-1 rounded-md border bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-muted-foreground">할인 {label}</p>
      <div className="space-y-0.5 tabular-nums">
        <p className="flex justify-between gap-3">
          <span className="text-muted-foreground">판매가</span>
          <span>{won(d.finalPrice)}</span>
        </p>
        <p className="flex justify-between gap-3">
          <span className="text-muted-foreground">매출(VAT 제외)</span>
          <span>{won(d.revenue)}</span>
        </p>
        <p className="flex justify-between gap-3">
          <span className="text-muted-foreground">수수료</span>
          <span>{won(d.fee)}</span>
        </p>
        <p className="flex justify-between gap-3 border-t pt-0.5">
          <span className="text-muted-foreground">순이익</span>
          <span
            className={
              profit >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'
            }
          >
            {profit >= 0 ? '+' : ''}
            {won(profit)}
          </span>
        </p>
        <p className="flex justify-between gap-3">
          <span className="text-muted-foreground">이익율</span>
          <span
            className={
              d.margin >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'
            }
          >
            {(d.margin * 100).toFixed(1)}%
          </span>
        </p>
      </div>
    </div>
  )
}

// ─── 커스텀 Dot ────────────────────────────────────────────────────────────────

function CustomDot(props: { cx?: number; cy?: number; payload?: { netProfit: number } }) {
  const { cx, cy, payload } = props
  if (cx === undefined || cy === undefined || !payload) return null
  const isLoss = payload.netProfit < 0
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3}
      fill={isLoss ? 'rgb(244,63,94)' : 'rgb(16,185,129)'}
      stroke="white"
      strokeWidth={1}
    />
  )
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function PricingSensitivityChart({ matrix, channelName }: Props) {
  const { cells } = matrix

  // 차트 데이터 변환 (툴팁 상세 표시용 필드 포함)
  const data: ChartDatum[] = cells.map((cell) => ({
    discount: `${(cell.discountRate * 100).toFixed(0)}%`,
    discountRate: cell.discountRate,
    netProfit: cell.netProfit,
    finalPrice: cell.finalPrice,
    revenue: cell.revenue,
    fee: cell.fee,
    margin: cell.margin,
  }))

  // 적자 전환점 탐색 (처음으로 netProfit < 0 되는 할인율)
  const breakEvenX = (() => {
    for (const d of data) {
      if (d.netProfit < 0) return d.discount
    }
    return null
  })()

  // Y축 도메인 — 0 라인이 항상 표시되도록
  const profits = cells.map((c) => c.netProfit)
  const minProfit = Math.min(...profits, 0)
  const maxProfit = Math.max(...profits, 0)
  const padding = Math.max(Math.abs(maxProfit - minProfit) * 0.1, 500)
  const yMin = Math.floor((minProfit - padding) / 1000) * 1000
  const yMax = Math.ceil((maxProfit + padding) / 1000) * 1000

  return (
    <div className="space-y-1">
      {channelName && (
        <p className="px-1 text-[10px] text-muted-foreground">민감도 차트 — {channelName}</p>
      )}
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
            <XAxis
              dataKey="discount"
              tick={{ fontSize: 10, fill: 'rgba(0,0,0,0.45)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: string, idx: number) => (idx % 2 === 0 ? value : '')}
            />
            <YAxis
              tickFormatter={fmtWon}
              tick={{ fontSize: 10, fill: 'rgba(0,0,0,0.45)' }}
              tickLine={false}
              axisLine={false}
              domain={[yMin, yMax]}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* 손익분기 0 라인 */}
            <ReferenceLine
              y={0}
              stroke="rgba(0,0,0,0.25)"
              strokeDasharray="4 3"
              label={{
                value: '손익분기',
                position: 'insideBottomRight',
                fontSize: 9,
                fill: 'rgba(0,0,0,0.45)',
              }}
            />

            {/* 적자 전환점 수직선 */}
            {breakEvenX && (
              <ReferenceLine
                x={breakEvenX}
                stroke="rgba(244,63,94,0.5)"
                strokeDasharray="4 3"
                label={{
                  value: '적자 전환',
                  position: 'insideTopRight',
                  fontSize: 9,
                  fill: 'rgba(244,63,94,0.85)',
                }}
              />
            )}

            <Line
              type="monotone"
              dataKey="netProfit"
              stroke="rgb(16,185,129)"
              strokeWidth={2}
              dot={<CustomDot />}
              activeDot={{ r: 4, fill: 'rgb(16,185,129)' }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
