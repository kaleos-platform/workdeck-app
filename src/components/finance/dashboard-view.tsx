'use client'

/**
 * 재무 관리 Deck — 요약 대시보드 클라이언트 뷰
 * DESIGN.md 준수: KPI 수치 text-2xl mono, chart-1..5, 상태색 라이트/다크 쌍, 평면 shadow-sm
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Landmark, CreditCard, BarChart3 } from 'lucide-react'
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  formatWon,
  formatSignedWon,
  formatPercent,
  deltaPercent,
  maskAccountNumber,
} from '@/components/finance/format'
import { FINANCE_UPLOAD_PATH } from '@/lib/deck-routes'
import Link from 'next/link'
import { AccountDialog } from '@/components/finance/account-dialog'
import { LiabilityDialog } from '@/components/finance/liability-dialog'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type AccountKind = 'BANK' | 'CARD'

interface AccountSnapshot {
  id: string
  name: string
  kind: AccountKind
  institution: string | null
  accountNumber: string | null
  balance: number | null
  openingBalance: number | null
  sparkline: (number | null)[] | null
}

interface LiabilityItem {
  id: string
  name: string
  lender: string | null
  principal: number
  balance: number
  rate: string | null
  dueDate: string | null
  monthlyPayment: number | null
  repaymentRate: number
}

interface TrendPoint {
  ym: string
  income: number
  expense: number
  net: number
}

interface ExpenseTop {
  categoryId: string | null
  name: string
  groupLabel: string | null
  amount: number
}

interface DashboardData {
  period: 'month' | 'year'
  label: string
  kpi: {
    totalCash: number
    prevTotalCash: number
    income: number
    prevIncome: number
    expense: number
    prevExpense: number
    net: number
    prevNet: number
    netWorth: number
    totalLiability: number
  }
  trend: TrendPoint[]
  accountSnapshots: AccountSnapshot[]
  expenseTop: ExpenseTop[]
  liabilities: LiabilityItem[]
}

// ─── 앵커 헬퍼 ────────────────────────────────────────────────────────────────

/** YYYY-MM 형식 현재 월 반환 */
function currentYm(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** YYYY-MM에 offset 개월을 더한다 */
function addMonthsToYm(ym: string, offset: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── 숫자 포맷 헬퍼 ───────────────────────────────────────────────────────────

/** 만/억 단위 축약 (Y축 레이블용) */
function shortWon(v: number): string {
  if (Math.abs(v) >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 10_000).toLocaleString('ko-KR')}만`
  return `${v.toLocaleString('ko-KR')}`
}

// ─── KPI 델타 배지 ────────────────────────────────────────────────────────────

function DeltaBadge({
  cur,
  prev,
  invertColor = false,
}: {
  cur: number
  prev: number
  invertColor?: boolean
}) {
  const delta = deltaPercent(cur, prev)
  const diff = cur - prev
  if (prev === 0 && cur === 0) return null

  const isPositive = diff > 0
  const green = invertColor ? !isPositive : isPositive
  const colorClass = green
    ? 'text-emerald-700 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400'

  return (
    <span className={`text-xs ${colorClass}`}>
      {formatSignedWon(diff)}
      {delta !== null ? ` (${formatPercent(delta, { sign: true })})` : ''}
    </span>
  )
}

// ─── 스파크라인 (SVG — 경량) ──────────────────────────────────────────────────

function AccountSparkline({ data }: { data: (number | null)[] }) {
  const values = data.filter((v): v is number => v !== null)
  if (values.length < 2) return <span className="text-xs text-muted-foreground">—</span>

  const w = 72
  const h = 22
  const pad = 2
  const maxVal = Math.max(...values)
  const minVal = Math.min(...values)
  const range = maxVal - minVal || 1
  const innerH = h - pad * 2

  // null이 있을 수 있으므로 전체 배열의 인덱스 기준으로 좌표 계산
  const step = (w - 2) / (data.length - 1)
  const pts: string[] = []
  data.forEach((v, i) => {
    if (v === null) return
    const x = (1 + i * step).toFixed(1)
    const y = (pad + innerH - ((v - minVal) / range) * innerH).toFixed(1)
    pts.push(`${x},${y}`)
  })

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      className="shrink-0 overflow-visible text-primary/60"
    >
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export function DashboardView() {
  const [period, setPeriod] = useState<'month' | 'year'>('month')
  const [anchor, setAnchor] = useState<string>(currentYm())
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  // 계좌·부채 관리 다이얼로그
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [liabilityDialogOpen, setLiabilityDialogOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ period, anchor })
      const res = await fetch(`/api/finance/dashboard?${params}`)
      if (!res.ok) throw new Error('대시보드 조회 실패')
      const json = (await res.json()) as DashboardData
      setData(json)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [period, anchor])

  useEffect(() => {
    void load()
  }, [load])

  // period 전환 시 anchor 초기화
  function handlePeriodChange(next: 'month' | 'year') {
    setPeriod(next)
    if (next === 'month') {
      setAnchor(currentYm())
    } else {
      setAnchor(String(new Date().getFullYear()))
    }
  }

  function stepAnchor(dir: -1 | 1) {
    if (period === 'month') {
      setAnchor((prev) => addMonthsToYm(prev, dir))
    } else {
      setAnchor((prev) => String(Number(prev) + dir))
    }
  }

  // 빈 상태 (데이터 없음)
  const isEmpty =
    data !== null &&
    data.accountSnapshots.length === 0 &&
    data.trend.every((t) => t.income === 0 && t.expense === 0)

  // 은행 잔고 합계 (null 무시)
  const bankTotal =
    data?.accountSnapshots
      .filter((a) => a.kind === 'BANK')
      .reduce((sum, a) => sum + (a.balance ?? 0), 0) ?? 0

  return (
    <div className="space-y-6">
      {/* 상단 컨트롤 */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={period}
          onValueChange={(v) => handlePeriodChange(v as 'month' | 'year')}
          className="shrink-0"
        >
          <TabsList>
            <TabsTrigger value="month">월간</TabsTrigger>
            <TabsTrigger value="year">연간</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-md"
            onClick={() => stepAnchor(-1)}
            aria-label="이전"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-20 text-center text-sm font-medium">{data?.label ?? anchor}</span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-md"
            onClick={() => stepAnchor(1)}
            aria-label="다음"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        {loading && <span className="text-xs text-muted-foreground">불러오는 중...</span>}
      </div>

      {/* 빈 상태 */}
      {isEmpty && (
        <div className="flex flex-col items-center gap-4 rounded-xl border bg-card px-6 py-16 text-center shadow-sm">
          <BarChart3 className="size-12 text-muted-foreground/40" />
          <div className="space-y-1">
            <p className="text-sm font-medium">아직 재무 데이터가 없습니다</p>
            <p className="text-xs text-muted-foreground">
              먼저 계좌를 등록한 뒤 거래 내역을 업로드해 보세요.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setAccountDialogOpen(true)}>
              계좌 등록
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={FINANCE_UPLOAD_PATH}>데이터 등록</Link>
            </Button>
          </div>
        </div>
      )}

      {/* KPI 4 카드 */}
      {!isEmpty && data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* ① 총 현금 잔고 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  총 현금 잔고
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="font-mono text-2xl font-semibold">{formatWon(data.kpi.totalCash)}</p>
                <DeltaBadge cur={data.kpi.totalCash} prev={data.kpi.prevTotalCash} />
              </CardContent>
            </Card>

            {/* ② 수입 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">수입</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="font-mono text-2xl font-semibold text-emerald-700 dark:text-emerald-400">
                  {formatWon(data.kpi.income)}
                </p>
                <DeltaBadge cur={data.kpi.income} prev={data.kpi.prevIncome} />
              </CardContent>
            </Card>

            {/* ③ 지출 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">지출</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="font-mono text-2xl font-semibold text-red-600 dark:text-red-400">
                  {formatWon(data.kpi.expense)}
                </p>
                <DeltaBadge cur={data.kpi.expense} prev={data.kpi.prevExpense} invertColor />
              </CardContent>
            </Card>

            {/* ④ 순현금흐름 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  순현금흐름
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-2">
                  <p
                    className={`font-mono text-2xl font-semibold ${
                      data.kpi.net >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {formatSignedWon(data.kpi.net)}
                  </p>
                  <Badge
                    className={
                      data.kpi.net >= 0
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-400'
                        : 'border-red-200 bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-400'
                    }
                    variant="outline"
                  >
                    {data.kpi.net >= 0 ? '흑자' : '적자'}
                  </Badge>
                </div>
                <DeltaBadge cur={data.kpi.net} prev={data.kpi.prevNet} />
              </CardContent>
            </Card>
          </div>

          {/* 순자산 보조 카드 */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="bg-muted/30">
              <CardContent className="flex items-center justify-between py-4">
                <span className="text-sm text-muted-foreground">순자산 (현금 − 부채)</span>
                <span
                  className={`font-mono text-sm font-semibold ${
                    data.kpi.netWorth >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {formatWon(data.kpi.netWorth)}
                </span>
              </CardContent>
            </Card>
            <Card className="bg-muted/30">
              <CardContent className="flex items-center justify-between py-4">
                <span className="text-sm text-muted-foreground">총 부채</span>
                <span className="font-mono text-sm font-semibold text-red-600 dark:text-red-400">
                  {formatWon(data.kpi.totalLiability)}
                </span>
              </CardContent>
            </Card>
          </div>

          {/* 현금흐름 추이 차트 */}
          <Card>
            <CardHeader>
              <CardTitle>현금흐름 추이</CardTitle>
            </CardHeader>
            <CardContent>
              {data.trend.length === 0 ? (
                <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                  데이터가 없습니다
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="ym"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: string) => {
                        const [y, m] = v.split('-')
                        return period === 'year' ? `${m}월` : `${y}-${m}`
                      }}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={shortWon}
                      width={52}
                    />
                    <Tooltip
                      formatter={
                        ((value: number, name: string) => [formatWon(value), name]) as never
                      }
                      labelFormatter={((label: string) => label) as never}
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 8,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="income" name="수입" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
                    <Bar
                      dataKey="expense"
                      name="지출"
                      fill="var(--chart-1)"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* 계좌별 잔고 스냅샷 */}
            <Card>
              <CardHeader>
                <CardTitle>계좌별 잔고</CardTitle>
                <CardAction>
                  <Button variant="outline" size="sm" onClick={() => setAccountDialogOpen(true)}>
                    관리
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                {data.accountSnapshots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">등록된 계좌가 없습니다</p>
                ) : (
                  <div className="divide-y">
                    {data.accountSnapshots.map((acct) => (
                      <div key={acct.id} className="flex items-center gap-3 py-2.5">
                        {acct.kind === 'BANK' ? (
                          <Landmark className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <CreditCard className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{acct.name}</p>
                          {acct.accountNumber && (
                            <p className="font-mono text-xs text-muted-foreground">
                              {maskAccountNumber(acct.accountNumber)}
                            </p>
                          )}
                        </div>
                        {acct.sparkline && acct.sparkline.some((v) => v !== null) && (
                          <AccountSparkline data={acct.sparkline} />
                        )}
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          {acct.balance !== null ? formatWon(acct.balance) : '—'}
                        </span>
                      </div>
                    ))}
                    {/* 은행 합계 */}
                    {data.accountSnapshots.some((a) => a.kind === 'BANK') && (
                      <div className="flex items-center justify-between pt-2.5">
                        <span className="text-xs text-muted-foreground">은행 합계</span>
                        <span className="font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                          {formatWon(bankTotal)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 계정과목별 지출 Top */}
            <Card>
              <CardHeader>
                <CardTitle>지출 TOP</CardTitle>
              </CardHeader>
              <CardContent>
                {data.expenseTop.length === 0 ? (
                  <p className="text-sm text-muted-foreground">지출 내역이 없습니다</p>
                ) : (
                  <ResponsiveContainer
                    width="100%"
                    height={Math.max(160, data.expenseTop.length * 36)}
                  >
                    <BarChart
                      layout="vertical"
                      data={data.expenseTop}
                      margin={{ top: 0, right: 48, left: 0, bottom: 0 }}
                    >
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={shortWon}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={80}
                      />
                      <Tooltip
                        formatter={((value: number) => [formatWon(value), '지출']) as never}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Bar dataKey="amount" name="지출" radius={[0, 3, 3, 0]}>
                        {data.expenseTop.map((_, i) => (
                          <Cell key={i} fill={`var(--chart-${(i % 5) + 1})`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 부채 현황 */}
          <Card>
            <CardHeader>
              <CardTitle>부채 현황</CardTitle>
              <CardAction>
                <Button variant="outline" size="sm" onClick={() => setLiabilityDialogOpen(true)}>
                  관리
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {data.liabilities.length === 0 ? (
                <p className="text-sm text-muted-foreground">등록된 부채가 없습니다</p>
              ) : (
                <div className="space-y-4">
                  {/* 카드 미결제 이중계상 안내 */}
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    카드 미결제 금액은 거래 내역에 이미 반영될 수 있습니다. 이중 계상에 주의해
                    주세요.
                  </p>
                  <div className="divide-y">
                    {data.liabilities.map((l) => (
                      <div key={l.id} className="space-y-2 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-sm font-medium">{l.name}</span>
                            {l.lender && (
                              <span className="ml-2 text-xs text-muted-foreground">{l.lender}</span>
                            )}
                          </div>
                          <span className="font-mono text-sm font-semibold text-red-600 tabular-nums dark:text-red-400">
                            {formatWon(l.balance)}
                          </span>
                        </div>
                        <Progress
                          value={Math.round(l.repaymentRate * 100)}
                          className={`h-1.5 ${
                            l.repaymentRate >= 0.6
                              ? '[&>div]:bg-emerald-500'
                              : '[&>div]:bg-amber-500'
                          }`}
                        />
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                          <span>상환율 {formatPercent(l.repaymentRate * 100)}</span>
                          {l.rate && <span>이율 {l.rate}</span>}
                          {l.dueDate && <span>만기 {l.dueDate}</span>}
                          {l.monthlyPayment && <span>월상환 {formatWon(l.monthlyPayment)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* 계좌 관리 다이얼로그 */}
      <AccountDialog
        open={accountDialogOpen}
        onOpenChange={setAccountDialogOpen}
        onChanged={load}
      />

      {/* 부채 관리 다이얼로그 */}
      <LiabilityDialog
        open={liabilityDialogOpen}
        onOpenChange={setLiabilityDialogOpen}
        onChanged={load}
      />
    </div>
  )
}
