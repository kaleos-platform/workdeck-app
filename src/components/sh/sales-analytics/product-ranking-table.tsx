'use client'

import { Fragment, useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, ArrowDown, ArrowUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  formatKRW,
  pctChange,
  MAX_OPTION_SERIES,
  type DateRange,
  type OptionSelection,
  type ProductRanking,
  type RankingRow,
  type MarginTotals,
} from '@/lib/sh/sales-analytics'
import type { SalesCoverage } from '@/hooks/use-product-sales'
import type { Channel } from './sales-analytics-page'

type SortKey = 'revenue' | 'quantity' | 'delta' | 'share' | 'profit' | 'marginRatio'

type Props = {
  ranking: ProductRanking | null
  /** 카테고리 필터로 랭킹에서 빠진 금액 — 채널 탭 총매출과의 차이를 설명한다. */
  excludedRevenue?: number
  excludedLabel?: string | null
  coverage: SalesCoverage | null
  prevPeriod: DateRange | null
  channels: Channel[]
  selection: OptionSelection
  onChange: (next: OptionSelection) => void
  loading: boolean
}

const qty = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}개`
const pct = (v: number | null) => (v === null ? '-' : `${(v * 100).toFixed(1)}%`)

function DeltaCell({ cur, prev }: { cur: number; prev: number }) {
  const d = pctChange(cur, prev)
  if (d === null) {
    return <span className="text-muted-foreground">{prev === 0 && cur > 0 ? '신규' : '-'}</span>
  }
  // pctChange 는 이미 퍼센트 값(소수 1자리 반올림)을 준다 — 100 을 다시 곱하지 말 것.
  const up = d >= 0
  return (
    <span className={up ? 'text-emerald-600' : 'text-rose-600'}>
      {up ? '+' : ''}
      {d.toFixed(1)}%
    </span>
  )
}

/**
 * 미매칭 사유별 내역.
 * "상품을 알 수 없음"과 "단종·삭제라 제외"는 성격이 완전히 달라서 한 줄로 뭉치면
 * 사용자가 매칭 작업이 남은 줄 오해한다. 0원인 사유는 감춘다.
 */
const REASON_LABELS: Record<string, string> = {
  directUnmatched: '상품 미연결',
  directExcluded: '단종·삭제 상품',
  rocketUnmapped: '로켓 외부코드 미매핑',
  rocketExcluded: '로켓 단종·삭제 상품',
}

function UnmatchedReasons({ byReason }: { byReason?: Record<string, number> }) {
  const parts = Object.entries(byReason ?? {})
    .filter(([, v]) => v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  // whitespace-normal 필수 — TableCell 기본이 nowrap 이라 부제가 옆 열을 침범한다.
  if (parts.length === 0) {
    return <p className="text-xs whitespace-normal text-muted-foreground">합계에는 포함됩니다</p>
  }
  return (
    <p className="text-xs whitespace-normal text-muted-foreground">
      {parts.map(([k, v], i) => (
        <span key={k}>
          {i > 0 && ' · '}
          {REASON_LABELS[k] ?? k} {formatKRW(v)}
        </span>
      ))}
    </p>
  )
}

/**
 * 공헌이익·이익률 두 칸. 원가가 없는 옵션이 섞이면 이익이 과대평가되므로 흐리게
 * 표시하고 툴팁으로 알린다(숫자를 숨기진 않는다 — 원가만 빠진 것이지 틀린 건 아니다).
 */
function MarginCells({
  m,
  small = false,
}: {
  m: MarginTotals | null | undefined
  small?: boolean
}) {
  const size = small ? 'text-xs' : ''
  if (!m) {
    return (
      <>
        <TableCell className={`text-right text-muted-foreground tabular-nums ${size}`}>-</TableCell>
        <TableCell className={`text-right text-muted-foreground tabular-nums ${size}`}>-</TableCell>
      </>
    )
  }
  const tone = m.contributionProfit < 0 ? 'text-rose-600' : ''
  const hint = m.costMissing ? '원가 미입력 옵션 포함 — 이익이 과대평가됨' : undefined
  return (
    <>
      <TableCell
        className={`text-right tabular-nums ${size} ${m.costMissing ? 'text-muted-foreground' : tone}`}
        title={hint}
      >
        {formatKRW(m.contributionProfit)}
        {m.costMissing && '*'}
      </TableCell>
      <TableCell
        className={`text-right tabular-nums ${size} ${m.costMissing ? 'text-muted-foreground' : tone}`}
        title={hint}
      >
        {pct(m.marginRatio)}
      </TableCell>
    </>
  )
}

function SortHead({
  k,
  sortKey,
  asc,
  onSort,
  children,
}: {
  k: SortKey
  sortKey: SortKey
  asc: boolean
  onSort: (k: SortKey) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className="inline-flex items-center gap-1 hover:text-foreground"
    >
      {children}
      {sortKey === k && (asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  )
}

export function ProductRankingTable({
  ranking,
  excludedRevenue = 0,
  excludedLabel = null,
  coverage,
  prevPeriod,
  channels,
  selection,
  onChange,
  loading,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [asc, setAsc] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showUnsold, setShowUnsold] = useState(false)

  const channelName = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels])

  const allRows = useMemo(() => ranking?.rows ?? [], [ranking])
  // 표시 필터일 뿐 — 합계·커버리지는 건드리지 않는다.
  // 판매 0 이어도 비용(광고비)이 나간 행은 "돈만 쓴 상품"이라 숨기지 않는다.
  const isUnsold = (r: RankingRow) =>
    r.quantity === 0 && r.revenue === 0 && !(r.margin && r.margin.contributionProfit !== 0)
  const unsoldCount = allRows.filter(isUnsold).length
  const visibleRows = useMemo(() => {
    const base = showUnsold ? allRows : allRows.filter((r) => !isUnsold(r))
    const dir = asc ? 1 : -1
    const val = (r: RankingRow) => {
      if (sortKey === 'quantity') return r.quantity
      if (sortKey === 'share') return r.share ?? 0
      if (sortKey === 'profit') return r.margin?.contributionProfit ?? -Infinity
      if (sortKey === 'marginRatio') return r.margin?.marginRatio ?? -Infinity
      if (sortKey === 'delta') return pctChange(r.revenue, r.prevRevenue) ?? -Infinity
      return r.revenue
    }
    return [...base].sort((a, b) => (val(a) - val(b)) * dir)
  }, [allRows, showUnsold, sortKey, asc])

  const selectedCount = selection.productIds.length + selection.optionIds.length
  const atMax = selectedCount >= MAX_OPTION_SERIES

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAsc((v) => !v)
    else {
      setSortKey(key)
      setAsc(false)
    }
  }

  function toggleExpand(productId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  function toggleProduct(productId: string) {
    const has = selection.productIds.includes(productId)
    if (!has && atMax) return
    onChange({
      ...selection,
      productIds: has
        ? selection.productIds.filter((id) => id !== productId)
        : [...selection.productIds, productId],
    })
  }

  function toggleOption(optionId: string) {
    const has = selection.optionIds.includes(optionId)
    if (!has && atMax) return
    onChange({
      ...selection,
      optionIds: has
        ? selection.optionIds.filter((id) => id !== optionId)
        : [...selection.optionIds, optionId],
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">상품별 판매 현황</CardTitle>
          {coverage && coverage.ratio !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant={coverage.ratio >= 0.95 ? 'secondary' : 'destructive'}>
                  상품 귀속 {(coverage.ratio * 100).toFixed(1)}%
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="text-xs">
                <div>
                  귀속 {formatKRW(coverage.attributedRevenue)} / 전체{' '}
                  {formatKRW(coverage.totalRevenue)}
                </div>
                <div className="text-muted-foreground">카테고리 필터와 무관한 전체 기준입니다</div>
                <div className="mt-1 text-muted-foreground">
                  직접배송{' '}
                  {coverage.direct.revenueTotal > 0
                    ? pct(coverage.direct.revenueAttributed / coverage.direct.revenueTotal)
                    : '-'}{' '}
                  · 로켓{' '}
                  {coverage.rocket.revenueTotal > 0
                    ? pct(coverage.rocket.revenueAttributed / coverage.rocket.revenueTotal)
                    : '-'}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          {prevPeriod && (
            <span className="text-xs text-muted-foreground">
              증감 기준 vs {prevPeriod.from} ~ {prevPeriod.to}
            </span>
          )}
          {excludedRevenue !== 0 && excludedLabel && (
            <span className="text-xs text-muted-foreground">
              · {excludedLabel} 제외 중 {formatKRW(excludedRevenue)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            차트 선택 {selectedCount}/{MAX_OPTION_SERIES}
          </span>
          {unsoldCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={() => setShowUnsold((v) => !v)}>
                  {showUnsold ? '미판매 숨기기' : `미판매 ${unsoldCount}개 보기`}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                <div>이번 기간엔 판매가 없고, 비교 구간에만 판매가 있던 상품입니다.</div>
                <div>
                  켜면 수량·매출 0, 증감 -100%로 표시돼 판매가 끊긴 상품을 찾을 수 있습니다.
                </div>
                <div className="mt-1 text-muted-foreground">
                  표시만 바뀌며 합계·비중·귀속률에는 영향이 없습니다. 광고비가 나간 상품은 항상
                  표시됩니다.
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중…</p>
        ) : allRows.length === 0 && (ranking?.unmatched.revenue ?? 0) === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            선택한 기간에 판매 데이터가 없습니다
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead className="w-10" />
                  <TableHead>상품</TableHead>
                  <TableHead className="w-24 text-right">
                    <SortHead sortKey={sortKey} asc={asc} k="quantity" onSort={toggleSort}>
                      수량
                    </SortHead>
                  </TableHead>
                  <TableHead className="w-32 text-right">
                    <SortHead sortKey={sortKey} asc={asc} k="revenue" onSort={toggleSort}>
                      매출
                    </SortHead>
                  </TableHead>
                  <TableHead className="w-20 text-right">
                    <SortHead sortKey={sortKey} asc={asc} k="delta" onSort={toggleSort}>
                      증감
                    </SortHead>
                  </TableHead>
                  <TableHead className="w-16 text-right">
                    <SortHead sortKey={sortKey} asc={asc} k="share" onSort={toggleSort}>
                      비중
                    </SortHead>
                  </TableHead>
                  <TableHead className="w-32 text-right">
                    <SortHead sortKey={sortKey} asc={asc} k="profit" onSort={toggleSort}>
                      공헌이익
                    </SortHead>
                  </TableHead>
                  <TableHead className="w-20 text-right">
                    <SortHead sortKey={sortKey} asc={asc} k="marginRatio" onSort={toggleSort}>
                      이익률
                    </SortHead>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((r) => {
                  const open = expanded.has(r.productId)
                  return (
                    <Fragment key={r.productId}>
                      <TableRow>
                        <TableCell>
                          <Checkbox
                            checked={selection.productIds.includes(r.productId)}
                            disabled={atMax && !selection.productIds.includes(r.productId)}
                            onCheckedChange={() => toggleProduct(r.productId)}
                            aria-label={`${r.productName} 차트에 표시`}
                          />
                        </TableCell>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => toggleExpand(r.productId)}
                            aria-label={open ? '내역 접기' : '내역 펼치기'}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            {open ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="truncate font-medium" title={r.productName}>
                          {r.productName}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{qty(r.quantity)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatKRW(r.revenue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <DeltaCell cur={r.revenue} prev={r.prevRevenue} />
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {pct(r.share)}
                        </TableCell>
                        <MarginCells m={r.margin} />
                      </TableRow>

                      {open && (
                        <>
                          {r.byChannel.map((c) => (
                            <TableRow
                              key={`${r.productId}-ch-${c.channelId}`}
                              className="bg-muted/30"
                            >
                              <TableCell />
                              <TableCell />
                              <TableCell className="truncate pl-8 text-xs text-muted-foreground">
                                채널 · {channelName.get(c.channelId) ?? c.channelId}
                              </TableCell>
                              <TableCell className="text-right text-xs tabular-nums">
                                {qty(c.quantity)}
                              </TableCell>
                              <TableCell className="text-right text-xs tabular-nums">
                                {formatKRW(c.revenue)}
                              </TableCell>
                              <TableCell />
                              <TableCell />
                              <TableCell />
                              <TableCell />
                            </TableRow>
                          ))}
                          {r.options.map((o) => (
                            <TableRow key={`${r.productId}-opt-${o.optionId}`}>
                              <TableCell>
                                <Checkbox
                                  checked={selection.optionIds.includes(o.optionId)}
                                  disabled={atMax && !selection.optionIds.includes(o.optionId)}
                                  onCheckedChange={() => toggleOption(o.optionId)}
                                  aria-label={`${o.optionName} 차트에 표시`}
                                />
                              </TableCell>
                              <TableCell />
                              <TableCell className="truncate pl-8 text-xs" title={o.optionName}>
                                옵션 · {o.optionName}
                              </TableCell>
                              <TableCell className="text-right text-xs tabular-nums">
                                {qty(o.quantity)}
                              </TableCell>
                              <TableCell className="text-right text-xs tabular-nums">
                                {formatKRW(o.revenue)}
                              </TableCell>
                              <TableCell className="text-right text-xs tabular-nums">
                                <DeltaCell cur={o.revenue} prev={o.prevRevenue} />
                              </TableCell>
                              <TableCell />
                              <MarginCells m={o.margin} small />
                            </TableRow>
                          ))}
                        </>
                      )}
                    </Fragment>
                  )
                })}

                {/* 미매칭 — 항상 마지막 고정. 정렬 대상 아님. */}
                {ranking && ranking.unmatched.revenue !== 0 && (
                  <TableRow className="border-t-2 bg-muted/50">
                    <TableCell />
                    <TableCell />
                    <TableCell>
                      <span className="font-medium">상품 미매칭</span>
                      <UnmatchedReasons byReason={ranking.unmatched.byReason} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {qty(ranking.unmatched.quantity)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatKRW(ranking.unmatched.revenue)}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {pct(ranking.unmatched.share)}
                    </TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                )}

                {ranking && (
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell />
                    <TableCell />
                    <TableCell>합계</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {qty(ranking.totals.quantity)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatKRW(ranking.totals.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <DeltaCell cur={ranking.totals.revenue} prev={ranking.totals.prevRevenue} />
                    </TableCell>
                    <TableCell />
                    <MarginCells m={ranking.marginTotals} />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
