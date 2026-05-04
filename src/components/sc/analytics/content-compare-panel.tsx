'use client'

import { useState, useMemo } from 'react'
import { X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import type { ContentCompareRow } from '@/lib/sc/metrics-types'

// ─── 색상 팔레트 (--chart-1 ~ --chart-5, 라이트/다크 모드 CSS 변수 사용) ──

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

// ─── 지표 정의 ────────────────────────────────────────────────────────────────

type MetricKey = 'views' | 'impressions' | 'likes' | 'comments' | 'externalClicks'

const METRIC_OPTIONS: Array<{ key: MetricKey; label: string }> = [
  { key: 'views', label: '조회' },
  { key: 'impressions', label: '노출' },
  { key: 'likes', label: '좋아요' },
  { key: 'comments', label: '댓글' },
  { key: 'externalClicks', label: '외부 클릭' },
]

// ─── 합계 표 정렬 ─────────────────────────────────────────────────────────────

type TotalSortKey = 'title' | MetricKey | 'internalClicks'
type SortDir = 'asc' | 'desc'

/** 합계 표 정렬 아이콘 */
function TotalSortIcon({
  col,
  sortKey,
  sortDir,
}: {
  col: TotalSortKey
  sortKey: TotalSortKey
  sortDir: SortDir
}) {
  if (sortKey !== col) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />
  return sortDir === 'asc' ? (
    <ArrowUp className="ml-1 inline h-3 w-3" />
  ) : (
    <ArrowDown className="ml-1 inline h-3 w-3" />
  )
}

// ─── 차트 데이터 변환 ─────────────────────────────────────────────────────────

/**
 * N개 ContentCompareRow → recharts 용 merged series.
 * dataKey = content.id (제목 중복 방지), 별도 idToTitle 맵 제공.
 */
function buildChartData(
  data: ContentCompareRow[],
  metric: MetricKey
): Array<Record<string, string | number>> {
  if (data.length === 0) return []

  // 유니온 date spine: 모든 콘텐츠의 날짜 합집합
  const allDates = new Set<string>()
  for (const row of data) {
    for (const d of row.daily) {
      allDates.add(d.date)
    }
  }
  const sortedDates = [...allDates].sort()

  return sortedDates.map((date) => {
    const point: Record<string, string | number> = { date }
    for (const row of data) {
      const dayData = row.daily.find((d) => d.date === date)
      point[row.id] = dayData?.[metric] ?? 0
    }
    return point
  })
}

// ─── X축 포맷 ─────────────────────────────────────────────────────────────────

function formatXDate(dateStr: string): string {
  // YYYY-MM-DD → MM-DD
  return typeof dateStr === 'string' ? dateStr.slice(5) : dateStr
}

// ─── 커스텀 Tooltip ──────────────────────────────────────────────────────────

function CompareTooltip({
  active,
  payload,
  label,
  idToTitle,
}: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; stroke: string }>
  label?: string
  idToTitle: Map<string, string>
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium text-foreground">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 tabular-nums">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: p.stroke }}
          />
          <span className="max-w-[120px] truncate text-muted-foreground">
            {idToTitle.get(p.dataKey) ?? p.dataKey}
          </span>
          <span className="ml-auto font-medium text-foreground">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Props ─────────────────────────────────────────────────────────────────

interface Props {
  data: ContentCompareRow[]
  onClose: () => void
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────

export function ContentComparePanel({ data, onClose }: Props) {
  const [metric, setMetric] = useState<MetricKey>('views')
  const [totalSortKey, setTotalSortKey] = useState<TotalSortKey>('views')
  const [totalSortDir, setTotalSortDir] = useState<SortDir>('desc')

  // id → title 매핑
  const idToTitle = useMemo(() => new Map(data.map((row) => [row.id, row.title])), [data])

  // 차트 데이터
  const chartData = useMemo(() => buildChartData(data, metric), [data, metric])

  // 데이터 없음 판단: 선택된 지표가 모든 콘텐츠에서 전부 0
  const hasData = chartData.some((point) => data.some((row) => (point[row.id] as number) > 0))

  // 합계 표 정렬
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      let cmp = 0
      if (totalSortKey === 'title') {
        cmp = a.title.localeCompare(b.title, 'ko')
      } else if (totalSortKey === 'internalClicks') {
        cmp = a.totals.internalClicks - b.totals.internalClicks
      } else {
        cmp = a.totals[totalSortKey] - b.totals[totalSortKey]
      }
      return totalSortDir === 'asc' ? cmp : -cmp
    })
  }, [data, totalSortKey, totalSortDir])

  function handleTotalSort(key: TotalSortKey) {
    if (totalSortKey === key) {
      setTotalSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setTotalSortKey(key)
      setTotalSortDir('desc')
    }
  }

  return (
    <section className="rounded-lg border bg-card" aria-label="콘텐츠 비교">
      {/* 패널 헤더 */}
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">콘텐츠 비교</h2>
          <span className="text-xs text-muted-foreground">{data.length}건 선택됨</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          aria-label="비교 패널 닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-6 p-5">
        {/* 콘텐츠 카드 row — 색상 indicator + 제목 + 채널 배지 */}
        <div className="flex flex-wrap gap-3">
          {data.map((row, idx) => (
            <div
              key={row.id}
              className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2"
            >
              {/* 색상 indicator */}
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-full"
                style={{ background: CHART_COLORS[idx] }}
                aria-hidden="true"
              />
              <span className="max-w-[180px] truncate text-sm font-medium">{row.title}</span>
              {/* 첫 번째 채널 배지만 표시 */}
              {row.channels.length > 0 && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[11px] font-normal">
                  {row.channels[0].name}
                </Badge>
              )}
              {row.channels.length > 1 && (
                <span className="text-[11px] text-muted-foreground">
                  +{row.channels.length - 1}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* 지표 선택 토글 */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="비교 지표 선택">
          {METRIC_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setMetric(opt.key)}
              aria-pressed={metric === opt.key}
              className={[
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                metric === opt.key
                  ? 'bg-primary text-primary-foreground'
                  : 'border text-muted-foreground hover:border-primary/40 hover:text-foreground',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 오버레이 라인 차트 */}
        {!hasData ? (
          <div className="flex h-[220px] items-center justify-center rounded-md border border-dashed">
            <p className="text-sm text-muted-foreground">선택된 기간에 데이터가 부족합니다.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="currentColor"
                className="text-border/60"
              />
              <XAxis
                dataKey="date"
                tickFormatter={formatXDate}
                tick={{ fontSize: 10, fill: 'currentColor' }}
                className="text-muted-foreground"
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'currentColor' }}
                className="text-muted-foreground"
                tickLine={false}
                axisLine={false}
                width={36}
                tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
              />
              <Tooltip content={<CompareTooltip idToTitle={idToTitle} />} />
              <Legend
                formatter={(value: string) => (
                  <span className="text-xs text-muted-foreground">
                    {idToTitle.get(value) ?? value}
                  </span>
                )}
              />
              {data.map((row, idx) => (
                <Line
                  key={row.id}
                  type="monotone"
                  dataKey={row.id}
                  stroke={CHART_COLORS[idx]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}

        {/* 합계 비교 표 */}
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            합계 비교
          </h3>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  {/* 제목 컬럼 */}
                  <th
                    scope="col"
                    onClick={() => handleTotalSort('title')}
                    className="cursor-pointer px-3 py-2 text-left text-xs font-medium text-muted-foreground transition select-none hover:text-foreground"
                  >
                    콘텐츠
                    <TotalSortIcon col="title" sortKey={totalSortKey} sortDir={totalSortDir} />
                  </th>
                  {/* 지표 컬럼들 */}
                  {(
                    [
                      { key: 'impressions' as const, label: '노출' },
                      { key: 'views' as const, label: '조회' },
                      { key: 'likes' as const, label: '좋아요' },
                      { key: 'comments' as const, label: '댓글' },
                      { key: 'externalClicks' as const, label: '외부 클릭' },
                      { key: 'internalClicks' as const, label: '내부 클릭' },
                    ] satisfies Array<{ key: TotalSortKey; label: string }>
                  ).map(({ key, label }) => (
                    <th
                      key={key}
                      scope="col"
                      onClick={() => handleTotalSort(key)}
                      className="cursor-pointer px-3 py-2 text-right text-xs font-medium text-muted-foreground transition select-none hover:text-foreground"
                    >
                      {label}
                      <TotalSortIcon col={key} sortKey={totalSortKey} sortDir={totalSortDir} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedData.map((row) => {
                  // 원래 색상 순서 유지 (정렬 후에도)
                  const origIdx = data.findIndex((d) => d.id === row.id)
                  const color = CHART_COLORS[origIdx] ?? CHART_COLORS[0]

                  return (
                    <tr key={row.id} className="border-t">
                      {/* 제목 + 색상 indicator */}
                      <td className="max-w-[200px] px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: color }}
                            aria-hidden="true"
                          />
                          <span className="truncate font-medium">{row.title}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {row.totals.impressions.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {row.totals.views.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {row.totals.likes.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {row.totals.comments.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {row.totals.externalClicks.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {row.totals.internalClicks.toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}
