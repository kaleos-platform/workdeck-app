'use client'

/**
 * 현금흐름 상세 "손익 흐름도"(Sankey) — 단일 기간의 손익 워터폴 시각화.
 * 데이터: GET /api/finance/cashflow/sankey. recharts Sankey + 커스텀 노드/링크 컬러링.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Sankey, Tooltip, ResponsiveContainer, Layer, Rectangle } from 'recharts'
import { formatWon, formatWonShort } from '@/components/finance/format'

type Grain = 'month' | 'quarter' | 'year'

interface SankeyNode {
  name: string
}
interface SankeyLink {
  source: number
  target: number
  value: number
}
interface SankeyTotals {
  totalIncome: number
  merchSales: number
  otherIncome: number
  cogs: number
  grossProfit: number
  opex: number
  operatingProfit: number
  financingCost: number
  net: number
}
interface SankeyData {
  grain: Grain
  period: { from: string; to: string; label: string }
  renderable: boolean
  reason?: string
  totals: SankeyTotals
  nodes: SankeyNode[]
  links: SankeyLink[]
}

// ─── 노드 색 (수입=파랑, 손익 스파인=청록, 비용=주황, 기타수익=노랑) ────────────
function nodeColor(name: string): string {
  if (name === '총수입') return 'var(--chart-3)'
  if (name === '영업이익') return 'var(--chart-4)'
  if (['상품매출', '매출총이익', '순현금흐름'].includes(name)) return 'var(--chart-2)'
  if (['매출원가', '판매관리비', '금융비용'].includes(name)) return 'var(--chart-1)'
  return 'var(--chart-5)' // 기타수익 등
}

// ─── 커스텀 노드: 색 rect + 이름·금액 라벨(깊이에 따라 좌/우 배치) ────────────
function SankeyNodeShape(props: {
  x: number
  y: number
  width: number
  height: number
  index: number
  payload: { name: string; value: number; depth?: number }
}) {
  const { x, y, width, height, payload } = props
  const color = nodeColor(payload.name)
  const isRight = (payload.depth ?? 0) >= 3
  const labelX = isRight ? x - 6 : x + width + 6
  const anchor = isRight ? 'end' : 'start'
  const midY = y + height / 2

  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={color} fillOpacity={0.95} radius={2} />
      <text
        x={labelX}
        y={midY - 4}
        textAnchor={anchor}
        className="fill-foreground"
        style={{ fontSize: 11, fontWeight: 600 }}
      >
        {payload.name}
      </text>
      <text
        x={labelX}
        y={midY + 9}
        textAnchor={anchor}
        className="fill-muted-foreground"
        style={{ fontSize: 10 }}
      >
        {formatWonShort(payload.value)}
      </text>
    </Layer>
  )
}

// ─── 커스텀 링크: source 노드 색으로 반투명 곡선 ──────────────────────────────
function SankeyLinkShape(props: {
  sourceX: number
  targetX: number
  sourceY: number
  targetY: number
  sourceControlX: number
  targetControlX: number
  linkWidth: number
  index: number
  payload: { source: { name: string } }
}) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload } =
    props
  const color = nodeColor(payload.source.name)
  return (
    <path
      d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={color}
      strokeWidth={Math.max(1, linkWidth)}
      strokeOpacity={0.28}
    />
  )
}

// ─── 요약 칩 ─────────────────────────────────────────────────────────────────
function SummaryChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold tabular-nums">{formatWonShort(value)}</span>
    </div>
  )
}

export function FinanceCashflowSankey({ grain }: { grain: Grain }) {
  const [data, setData] = useState<SankeyData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (g: Grain) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/finance/cashflow/sankey?grain=${g}`)
      if (!res.ok) throw new Error('흐름도 데이터 조회 실패')
      const json: SankeyData = await res.json()
      setData(json)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(grain)
  }, [load, grain])

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">데이터가 없습니다.</p>
  }

  const t = data.totals

  return (
    <div className="space-y-3">
      {/* 요약 칩 */}
      <div className="flex flex-wrap items-center gap-2">
        <SummaryChip label="총수입" value={t.totalIncome} color="var(--chart-3)" />
        <SummaryChip label="매출총이익" value={t.grossProfit} color="var(--chart-2)" />
        <SummaryChip label="영업이익" value={t.operatingProfit} color="var(--chart-4)" />
        <SummaryChip label="순현금흐름" value={t.net} color="var(--chart-2)" />
        <span className="ml-auto text-xs text-muted-foreground">{data.period.label} 기준 · 손익 흐름</span>
      </div>

      {/* 흐름도 or 경고 */}
      {data.renderable && data.nodes.length > 0 ? (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <ResponsiveContainer width="100%" height={380}>
            <Sankey
              data={{ nodes: data.nodes, links: data.links }}
              nodePadding={28}
              nodeWidth={12}
              margin={{ top: 12, right: 90, bottom: 12, left: 60 }}
              node={SankeyNodeShape as never}
              link={SankeyLinkShape as never}
            >
              <Tooltip
                formatter={((v: number) => formatWon(v)) as never}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
            </Sankey>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card py-16 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            {data.reason ?? '이 기간은 흐름도를 표시할 수 없습니다.'}
          </p>
        </div>
      )}

      {/* 캡션 */}
      <p className="text-[11px] text-muted-foreground">
        손익 흐름도: 총수입 → 매출원가/매출총이익 → 판매관리비/영업이익 → 금융비용/순현금흐름. 리프
        노드에 마우스를 올리면 금액이 표시됩니다.
      </p>
    </div>
  )
}
