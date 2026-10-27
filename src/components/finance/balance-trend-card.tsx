'use client'

/**
 * 재무 잔액 추이 페이지 — 월별 잔액 카드.
 * 월말 현금·부채·순자산 라인 + 월별 표(증감·버틸 개월수·잔액 체인 정합성). 행 클릭 시 계좌·부채별 분해.
 * 데이터: GET /api/finance/balance-trend (src/lib/finance/balance-trend.ts)
 */
import { Fragment, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoHint } from '@/components/finance/info-hint'
import { formatWon, formatWonShort, formatSignedWon } from '@/components/finance/format'
import { cn } from '@/lib/utils'
import { runwayLabel, type BalanceTrendRow } from '@/lib/finance/balance-trend'

function SignedDelta({ value }: { value: number | null }) {
  if (value == null) return null
  return (
    <span
      className={cn(
        'block text-[11px] tabular-nums',
        value > 0
          ? 'text-emerald-700 dark:text-emerald-400'
          : value < 0
            ? 'text-red-600 dark:text-red-400'
            : 'text-muted-foreground'
      )}
    >
      {formatSignedWon(value)}
    </span>
  )
}

const TABLE_INITIAL = 6

export function BalanceTrendCard({ rows }: { rows: BalanceTrendRow[] }) {
  const [openYm, setOpenYm] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const allRows = [...rows].reverse() // 최신 달이 위
  const tableRows = showAll ? allRows : allRows.slice(0, TABLE_INITIAL)
  const hiddenCount = allRows.length - tableRows.length
  // 부채 스냅샷은 기록 시작 달부터만 있다 — 그 전 구간은 현금 선만 그려진다.
  const liabilityFromYm = rows.find((r) => r.liability != null)?.ym ?? null
  const liabilityNote =
    liabilityFromYm == null
      ? '부채 기록이 아직 없어 부채·순자산은 표시되지 않습니다.'
      : rows[0] && rows[0].ym < liabilityFromYm
        ? `부채·순자산은 ${liabilityFromYm}부터 기록되어 그 전 달은 현금만 표시됩니다.`
        : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          월별 잔액
          <InfoHint
            content={
              <>
                월말 기준 은행 계좌 잔액 합(현금)과 등록 부채, 순자산(현금 − 부채)입니다. 카드
                미결제액은 포함하지 않습니다. 부채는 기록을 시작한 달부터 표시됩니다.
              </>
            }
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="ym"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: string) => `${v.slice(2, 4)}.${v.slice(5)}`}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatWonShort(v).replace('₩', '')}
              width={56}
            />
            <Tooltip
              formatter={((value: number, name: string) => [formatWon(value), name]) as never}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              dataKey="cash"
              name="현금"
              stroke="var(--chart-2)"
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
            />
            <Line
              dataKey="liability"
              name="부채"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="netWorth"
              name="순자산"
              stroke="var(--chart-3)"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
        {liabilityNote && <p className="text-xs text-muted-foreground">{liabilityNote}</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 text-left font-medium">월</th>
                <th className="py-2 text-right font-medium">현금</th>
                <th className="py-2 text-right font-medium">부채</th>
                <th className="py-2 text-right font-medium">순자산</th>
                <th className="py-2 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    버틸 개월
                    <InfoHint content="월말 현금 ÷ 직전 6개월 월평균 현금 감소액(실제 잔액 변화). 현금이 늘었으면 '소진 없음'. 진행 중인 달은 직전 완결 월까지 기준입니다." />
                  </span>
                </th>
                <th className="py-2 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    잔액 체인 차이
                    <InfoHint content="현금 증감 − 그 달 은행 거래 순액(이체·분석 제외 포함). 0이 아니면 거래내역 업로드 누락이나 다른 계좌로 잘못 적재된 내역이 있다는 신호입니다." />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => {
                const open = openYm === r.ym
                return (
                  <Fragment key={r.ym}>
                    <tr
                      className="cursor-pointer border-b align-top hover:bg-muted/40"
                      onClick={() => setOpenYm(open ? null : r.ym)}
                    >
                      <td className="py-2">
                        <span className="inline-flex items-center gap-1">
                          {open ? (
                            <ChevronDown className="size-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-3.5 text-muted-foreground" />
                          )}
                          <span className="font-mono">{r.ym}</span>
                          {r.inProgress && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                              진행 중
                            </Badge>
                          )}
                          {r.carried.length > 0 && (
                            <InfoHint
                              className="text-amber-600 dark:text-amber-400"
                              content={
                                <>
                                  이 달 거래내역이 없어 이전 달 잔액을 이어 쓴 계좌:
                                  <br />
                                  {r.carried.map((c) => `${c.name} (${c.fromYm} 값)`).join(', ')}
                                </>
                              }
                            />
                          )}
                        </span>
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {formatWon(r.cash)}
                        <SignedDelta value={r.cashDelta} />
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {r.liability == null ? '—' : formatWon(r.liability)}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {r.netWorth == null ? '—' : formatWon(r.netWorth)}
                        <SignedDelta value={r.netWorthDelta} />
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {runwayLabel(r.runwayMonths, r.cashBurn)}
                      </td>
                      <td
                        className={cn(
                          'py-2 text-right font-mono tabular-nums',
                          r.flowGap !== 0 && 'text-amber-700 dark:text-amber-400'
                        )}
                      >
                        {r.flowGap === 0 ? (
                          <span className="text-muted-foreground">0</span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <AlertTriangle className="size-3" aria-label="불일치" />
                            {formatSignedWon(r.flowGap)}
                          </span>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b bg-muted/20">
                        <td colSpan={6} className="px-6 py-2">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <p className="mb-1 text-xs font-medium text-muted-foreground">계좌</p>
                              {r.accounts.length === 0 ? (
                                <p className="text-xs text-muted-foreground">없음</p>
                              ) : (
                                r.accounts.map((a) => (
                                  <div key={a.id} className="flex justify-between gap-2 text-xs">
                                    <span className="truncate">
                                      {a.name}
                                      {a.inactive && (
                                        <span className="ml-1 text-muted-foreground">(미사용)</span>
                                      )}
                                      {a.carriedFrom && (
                                        <span className="ml-1 text-amber-700 dark:text-amber-400">
                                          {a.carriedFrom} 값 이월
                                        </span>
                                      )}
                                    </span>
                                    <span className="font-mono tabular-nums">
                                      {formatWon(a.balance)}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-medium text-muted-foreground">부채</p>
                              {r.liability == null ? (
                                <p className="text-xs text-muted-foreground">기록 전</p>
                              ) : r.liabilities.length === 0 ? (
                                <p className="text-xs text-muted-foreground">없음</p>
                              ) : (
                                r.liabilities.map((l) => (
                                  <div key={l.id} className="flex justify-between gap-2 text-xs">
                                    <span className="truncate">{l.name}</span>
                                    <span className="font-mono tabular-nums">
                                      {formatWon(l.balance)}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {hiddenCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full text-xs text-muted-foreground"
              onClick={() => setShowAll(true)}
            >
              이전 {hiddenCount}개월 더 보기
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
