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

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { value: number }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  const profit = payload[0].value
  return (
    <div className="rounded-md border bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-muted-foreground">할인 {label}</p>
      <p className={profit >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
        순이익 {profit >= 0 ? '+' : ''}
        {Math.round(profit).toLocaleString('ko-KR')}원
      </p>
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

  // 차트 데이터 변환
  const data = cells.map((cell) => ({
    discount: `${(cell.discountRate * 100).toFixed(0)}%`,
    discountRate: cell.discountRate,
    netProfit: cell.netProfit,
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
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
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
              label={{ value: '손익분기', position: 'right', fontSize: 9, fill: 'rgba(0,0,0,0.4)' }}
            />

            {/* 적자 전환점 수직선 */}
            {breakEvenX && (
              <ReferenceLine
                x={breakEvenX}
                stroke="rgba(244,63,94,0.5)"
                strokeDasharray="4 3"
                label={{ value: '적자', position: 'top', fontSize: 9, fill: 'rgba(244,63,94,0.8)' }}
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
