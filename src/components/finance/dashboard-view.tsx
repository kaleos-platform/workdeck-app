'use client'

/**
 * 재무 관리 Deck — 요약 대시보드 클라이언트 뷰
 * DESIGN.md 준수: KPI 수치 text-2xl mono, chart-1..5, 상태색 라이트/다크 쌍, 평면 shadow-sm
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, BarChart3 } from 'lucide-react'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Checkbox } from '@/components/ui/checkbox'
import { InfoHint } from '@/components/finance/info-hint'
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
} from '@/components/finance/format'
import { FINANCE_UPLOAD_PATH } from '@/lib/deck-routes'
import Link from 'next/link'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { AccountDialog } from '@/components/finance/account-dialog'
import {
  LiabilityFormDialog,
  type Liability as LiabilityFormData,
  type LiabilityAccountOption,
} from '@/components/finance/liability-form-dialog'
import {
  LiabilityRepaymentApplyDialog,
  type RepaymentApplyTarget,
} from '@/components/finance/liability-repayment-apply-dialog'

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
  // 백엔드 Phase 3 신규 필드
  accountId: string | null
  memo: string | null
  pending: {
    count: number
    sum: number
    throughDate: string | null
  }
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
    /** 직전 완결 3개월 평균 지출 */
    monthlyBurn: number
    /** 총 현금 ÷ 월평균 지출. 지출 데이터 없으면 null */
    cashRunwayMonths: number | null
    /** 순자산 ÷ 월평균 지출. 지출 데이터 없으면 null */
    runwayMonths: number | null
  }
  trend: TrendPoint[]
  accountSnapshots: AccountSnapshot[]
  expenseTop: ExpenseTop[]
  liabilities: LiabilityItem[]
  /** 현재 기간 수입·지출에서 빠진 분석 제외 거래 수(포함 토글 on 이면 0). */
  excludedCount: number
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

/** YYYY-MM → YYYY-Qn (해당 월이 속한 분기) */
function ymToYq(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
}

/** YYYY-Qn에 offset 분기를 더한다 */
function addQuartersToYq(yq: string, offset: number): string {
  const [y, q] = yq.split('-Q').map(Number)
  const idx = y * 4 + (q - 1) + offset
  return `${Math.floor(idx / 4)}-Q${(idx % 4) + 1}`
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

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export function DashboardView() {
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year'>('month')
  // 기본 표시월 = 직전월(당월은 데이터가 비어 보임).
  const [anchor, setAnchor] = useState<string>(addMonthsToYm(currentYm(), -1))
  // 분석 제외 거래 포함 — 기본 off. 잔액(스냅샷)은 항상 전체 기준이라 영향 없음.
  // 이 화면은 URL 상태를 쓰지 않아(useSearchParams→Suspense 경계 필요) 로컬 state 로 둔다.
  const [includeExcluded, setIncludeExcluded] = useState(false)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  // 계좌 관리 다이얼로그
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)

  // 부채 추가/수정 다이얼로그
  const [liabilityFormOpen, setLiabilityFormOpen] = useState(false)
  const [editingLiability, setEditingLiability] = useState<LiabilityFormData | null>(null)

  // 잔액 반영 다이얼로그
  const [applyOpen, setApplyOpen] = useState(false)
  const [applyTarget, setApplyTarget] = useState<RepaymentApplyTarget | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ period, anchor })
      if (includeExcluded) params.set('includeExcluded', '1')
      const res = await fetch(`/api/finance/dashboard?${params}`)
      if (!res.ok) throw new Error('대시보드 조회 실패')
      const json = (await res.json()) as DashboardData
      setData(json)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [period, anchor, includeExcluded])

  useEffect(() => {
    void load()
  }, [load])

  // 부채 추가 버튼 — 폼 초기화 후 열기
  function startAddLiability() {
    setEditingLiability(null)
    setLiabilityFormOpen(true)
  }

  // 부채 수정 버튼 — LiabilityItem을 LiabilityFormData로 변환
  function startEditLiability(l: LiabilityItem) {
    setEditingLiability({
      id: l.id,
      name: l.name,
      lender: l.lender,
      principal: l.principal,
      balance: l.balance,
      rate: l.rate,
      dueDate: l.dueDate,
      monthlyPayment: l.monthlyPayment,
      memo: l.memo,
      accountId: l.accountId,
    })
    setLiabilityFormOpen(true)
  }

  // 부채 삭제
  async function handleDeleteLiability(l: LiabilityItem) {
    if (!confirm(`"${l.name}"을(를) 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/finance/liabilities/${l.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('부채가 삭제되었습니다')
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  // 잔액 반영 버튼 — 대상 세팅 후 다이얼로그 열기
  function startApply(l: LiabilityItem) {
    setApplyTarget({
      id: l.id,
      name: l.name,
      balance: l.balance,
      pending: l.pending,
    })
    setApplyOpen(true)
  }

  // 계좌 목록 → LiabilityAccountOption 변환
  const liabilityAccountOptions: LiabilityAccountOption[] = (data?.accountSnapshots ?? []).map(
    (a) => ({
      id: a.id,
      name: a.name,
      institution: a.institution ?? '',
    })
  )

  // period 전환 시 anchor 초기화
  function handlePeriodChange(next: 'month' | 'quarter' | 'year') {
    setPeriod(next)
    if (next === 'month') {
      setAnchor(addMonthsToYm(currentYm(), -1))
    } else if (next === 'quarter') {
      // 직전월이 속한 분기(당월 초 진입 시 빈 분기 회피).
      setAnchor(ymToYq(addMonthsToYm(currentYm(), -1)))
    } else {
      setAnchor(String(new Date().getFullYear()))
    }
  }

  function stepAnchor(dir: -1 | 1) {
    if (period === 'month') {
      setAnchor((prev) => addMonthsToYm(prev, dir))
    } else if (period === 'quarter') {
      setAnchor((prev) => addQuartersToYq(prev, dir))
    } else {
      setAnchor((prev) => String(Number(prev) + dir))
    }
  }

  // 빈 상태 (데이터 없음)
  const isEmpty =
    data !== null &&
    data.accountSnapshots.length === 0 &&
    data.trend.every((t) => t.income === 0 && t.expense === 0)

  // 분석 제외 안내 — 수입·지출 카드 공용(제외된 거래가 있을 때만).
  const excludedHint =
    data && data.excludedCount > 0 ? (
      <InfoHint
        content={`분석 제외 거래 ${data.excludedCount}건이 수입·지출에서 빠졌습니다. 총현금(잔액)은 실제 잔액이라 포함되므로 수입−지출과 잔액 변동이 다를 수 있습니다.`}
      />
    ) : null

  return (
    <div className="space-y-6">
      {/* 상단 컨트롤 */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={period}
          onValueChange={(v) => handlePeriodChange(v as 'month' | 'quarter' | 'year')}
          className="shrink-0"
        >
          <TabsList>
            <TabsTrigger value="month">월간</TabsTrigger>
            <TabsTrigger value="quarter">분기</TabsTrigger>
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

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={includeExcluded}
            onCheckedChange={(v) => setIncludeExcluded(v === true)}
            aria-label="분석 제외 거래 포함"
          />
          분석 제외 거래 포함
        </label>

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
                <CardTitle className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                  수입
                  {excludedHint}
                </CardTitle>
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
                <CardTitle className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                  지출
                  {excludedHint}
                </CardTitle>
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
          <div className="grid gap-4 sm:grid-cols-3">
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
            <Card className="bg-muted/30">
              <CardContent className="flex items-center justify-between gap-2 py-4">
                <span className="text-sm text-muted-foreground">
                  런웨이
                  <span className="block text-xs">
                    월평균 지출 {formatWon(data.kpi.monthlyBurn)} · 직전 3개월
                  </span>
                </span>
                <span className="shrink-0 space-y-0.5 text-right text-xs whitespace-nowrap text-muted-foreground">
                  {(
                    [
                      ['현금', data.kpi.cashRunwayMonths],
                      ['순자산', data.kpi.runwayMonths],
                    ] as const
                  ).map(([label, v]) => (
                    <span key={label} className="block">
                      {label}{' '}
                      <span className="font-mono text-sm font-semibold text-foreground">
                        {v == null ? '—' : `${v}개월`}
                      </span>
                    </span>
                  ))}
                </span>
              </CardContent>
            </Card>
          </div>

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

          {/* 부채 현황 */}
          <Card>
            <CardHeader>
              <CardTitle>부채 현황</CardTitle>
              <CardAction>
                <Button variant="outline" size="sm" onClick={startAddLiability}>
                  <Plus className="mr-1 size-3.5" />
                  부채 추가
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
                        {/* 부채 이름 + 잔액 + 수정/삭제 버튼 */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-sm font-medium">{l.name}</span>
                            {l.lender && (
                              <span className="ml-2 text-xs text-muted-foreground">{l.lender}</span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-red-600 tabular-nums dark:text-red-400">
                              {formatWon(l.balance)}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => startEditLiability(l)}
                              aria-label="수정"
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => void handleDeleteLiability(l)}
                              aria-label="삭제"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>

                        {/* 감지된 상환 배지 + 잔액 반영 버튼 */}
                        {l.pending.count > 0 && (
                          <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 dark:border-emerald-800 dark:bg-emerald-950/40">
                            <span className="text-xs text-emerald-700 dark:text-emerald-400">
                              상환 {l.pending.count}건 감지 · {formatWon(l.pending.sum)}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 border-emerald-300 px-2 text-[11px] text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-900"
                              onClick={() => startApply(l)}
                            >
                              잔액 반영
                            </Button>
                          </div>
                        )}

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

      {/* 부채 추가/수정 다이얼로그 */}
      <LiabilityFormDialog
        open={liabilityFormOpen}
        onOpenChange={setLiabilityFormOpen}
        liability={editingLiability}
        accounts={liabilityAccountOptions}
        onSaved={load}
      />

      {/* 잔액 반영 다이얼로그 */}
      <LiabilityRepaymentApplyDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        liability={applyTarget}
        onSaved={load}
      />
    </div>
  )
}
