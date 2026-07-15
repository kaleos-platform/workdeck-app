'use client'

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Pin, X, Search, ArrowUp, ArrowDown, ListFilter } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  formatWon,
  formatPercent,
  flowRoleBadge,
  accountKindLabel,
  classStatusBadge,
} from '@/components/finance/format'
import type { PnlMetrics } from '@/lib/finance/pnl-metrics'
import type { FinAccountKind, FinClassStatus } from '@/generated/prisma/enums'
import { FinanceCashflowSankey } from '@/components/finance/cashflow-sankey'
import { CashflowPeriodPicker } from '@/components/finance/cashflow-period-picker'
import {
  buildCashflowGroups,
  type CashflowLeaf,
  type CashflowGroup,
  type DisplayMode,
} from '@/lib/finance/cashflow-grouping'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ymOf } from '@/lib/finance/aggregate'
import {
  defaultSelectedPeriods,
  availablePeriods,
  bucketLabel,
  type Grain,
} from '@/lib/finance/periods'
import { FINANCE_UPLOAD_PATH } from '@/lib/deck-routes'

// ─── 타입 ────────────────────────────────────────────────────────────────────

type ViewMode = 'table' | 'flow'
// 손익 지표 표시 관점 — 손익계산서(기능별) vs 공헌이익(원가행태별). 둘 다 영업이익으로 수렴.
type ProfitView = 'income-statement' | 'contribution'

// 표시 컬럼(기간) — 핀이면 계정과목 옆 sticky. 고정폭이라 left offset 정확.
const ACCOUNT_W = 220
const PERIOD_W = 160
interface DisplayColumn {
  bucket: string
  pinned: boolean
  left: number
}

/** data.buckets(오름차순)를 핀/비핀으로 파티션 → 핀은 계정과목 옆으로 이동 + left 부여.
 *  핀셋을 직접 순회하지 않으므로 피커에서 해제된 버킷은 자연 탈락. */
function buildDisplayColumns(buckets: string[], pinned: Set<string>): DisplayColumn[] {
  const pinnedCols = buckets.filter((b) => pinned.has(b))
  const unpinned = buckets.filter((b) => !pinned.has(b))
  return [
    ...pinnedCols.map((bucket, i) => ({ bucket, pinned: true, left: ACCOUNT_W + i * PERIOD_W })),
    ...unpinned.map((bucket) => ({ bucket, pinned: false, left: 0 })),
  ]
}

/** 핀 컬럼 셀의 sticky className/style(행 배경색 필수). */
function pinCell(col: DisplayColumn, rowBg: string): { className: string; style?: CSSProperties } {
  if (!col.pinned) return { className: '' }
  return { className: cn('sticky z-10', rowBg), style: { left: col.left } }
}

// 리프 행 = 그룹핑 유틸의 CashflowLeaf와 동일 구조(라우트가 리프 단위로 내려줌).
type CashflowRow = CashflowLeaf

interface CashflowTotalEntry {
  values: Record<string, number>
  changePct: number | null
}

interface LeafOption {
  id: string
  name: string
  type: 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY' | 'EQUITY' | 'TRANSFER'
  parentName: string | null
}

interface CashflowData {
  grain: Grain
  from: string
  to: string
  buckets: string[]
  incomeRows: CashflowRow[]
  expenseRows: CashflowRow[]
  totals: {
    income: CashflowTotalEntry
    expense: CashflowTotalEntry
    net: CashflowTotalEntry
  }
  metrics: PnlMetrics
  leafOptions: LeafOption[]
  exclude: string[]
}

// ─── 선택(행/그룹 클릭) → 거래내역 조회 대상 ──────────────────────────────────

interface Selection {
  /** 하이라이트용 키 — group.key 또는 leaf.key. */
  key: string
  title: string
  direction: 'IN' | 'OUT'
  /** 대상 계정과목 id들(리프=1개, 대분류=하위 리프 전부). 미분류만이면 빈 배열. */
  categoryIds: string[]
  /** 미분류 거래 포함 여부(미분류 리프 클릭/혼합 서브그룹). */
  uncategorized: boolean
}

/** 리프 key(`${type}:${id}` | `__none_${type}`) → 계정과목 id(미분류면 null). */
function leafCategoryId(leaf: CashflowLeaf): string | null {
  if (leaf.key.startsWith('__none_')) return null
  return leaf.key.split(/:(.+)/)[1] ?? null
}

function selectionFromLeaf(leaf: CashflowLeaf): Selection {
  const id = leafCategoryId(leaf)
  return {
    key: leaf.key,
    title: leaf.name,
    direction: leaf.type === 'INCOME' ? 'IN' : 'OUT',
    categoryIds: id ? [id] : [],
    uncategorized: id === null,
  }
}

function selectionFromGroup(group: CashflowGroup, section: '수입' | '지출'): Selection {
  const ids = group.leaves.map(leafCategoryId)
  return {
    key: group.key,
    title: group.label,
    direction: section === '수입' ? 'IN' : 'OUT',
    categoryIds: ids.filter((x): x is string => x !== null),
    uncategorized: ids.some((x) => x === null),
  }
}

// ─── 차트 색 (JIT purge 방지 — 동적 클래스 금지) ────────────────────────────

const CHART_BG_CLASSES = [
  'bg-chart-1',
  'bg-chart-2',
  'bg-chart-3',
  'bg-chart-4',
  'bg-chart-5',
] as const

// ─── 증감% 셀 클래스 ─────────────────────────────────────────────────────────

function changePctClass(pct: number | null): string {
  if (pct == null) return 'text-muted-foreground'
  if (pct > 0) return 'text-emerald-700 dark:text-emerald-400'
  if (pct < 0) return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}

// ─── 순현금흐름 금액 셀 클래스 ───────────────────────────────────────────────

function netValueClass(val: number): string {
  if (val > 0) return 'text-emerald-700 dark:text-emerald-400'
  if (val < 0) return 'text-red-600 dark:text-red-400'
  return ''
}

// ─── 컨트롤 세그먼트 버튼 그룹 ───────────────────────────────────────────────

function SegmentGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex rounded-md border bg-background">
        {options.map((opt, i) => (
          <Button
            key={opt.value}
            variant={value === opt.value ? 'default' : 'ghost'}
            size="sm"
            className={cn(
              'h-8 rounded-none px-3 text-xs font-medium',
              i === 0 && 'rounded-l-md',
              i === options.length - 1 && 'rounded-r-md',
              i > 0 && 'border-l'
            )}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export function FinanceCashflowView() {
  const [view, setView] = useState<ViewMode>('table')
  const [grain, setGrain] = useState<Grain>('month')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('hierarchy')
  const [profitView, setProfitView] = useState<ProfitView>('income-statement')
  // 표시 기간(오름차순) — 기본은 직전월까지 최근 N. grain 변경 시 리셋.
  const [selectedPeriods, setSelectedPeriods] = useState<string[]>(() =>
    defaultSelectedPeriods('month', ymOf(new Date()))
  )
  const [pinnedPeriods, setPinnedPeriods] = useState<Set<string>>(new Set())
  // 흐름도 단일 기간(버킷키) — 기본 최신(직전월이 속한 버킷).
  const [flowPeriod, setFlowPeriod] = useState<string>(
    () => availablePeriods('month', ymOf(new Date()))[0]
  )
  const [data, setData] = useState<CashflowData | null>(null)
  const [loading, setLoading] = useState(true)
  // 선택된 계정과목/대분류 — 우측 거래내역 패널 대상.
  const [selected, setSelected] = useState<Selection | null>(null)

  // 제외 계정과목 — URL 쿼리(?exclude=)가 단일 소스(새로고침·링크공유 유지).
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const excludeParam = searchParams.get('exclude') ?? ''
  const excluded = useMemo(() => new Set(excludeParam.split(',').filter(Boolean)), [excludeParam])

  const setExcluded = useCallback(
    (next: Set<string>) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next.size > 0) params.set('exclude', [...next].join(','))
      else params.delete('exclude')
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  const load = useCallback(async (g: Grain, periods: string[], exclude: string) => {
    if (periods.length === 0) return
    setLoading(true)
    setSelected(null)
    try {
      const qs = new URLSearchParams({ grain: g, periods: periods.join(',') })
      if (exclude) qs.set('exclude', exclude)
      const res = await fetch(`/api/finance/cashflow?${qs}`)
      if (!res.ok) throw new Error('현금흐름 데이터 조회 실패')
      const json: CashflowData = await res.json()
      setData(json)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(grain, selectedPeriods, excludeParam)
  }, [load, grain, selectedPeriods, excludeParam])

  // grain 변경: 테이블 기본 기간·핀 초기화 + 흐름도 기간을 해당 grain 최신으로 리셋.
  function handleGrainChange(g: Grain) {
    setGrain(g)
    setSelectedPeriods(defaultSelectedPeriods(g, ymOf(new Date())))
    setPinnedPeriods(new Set())
    setFlowPeriod(availablePeriods(g, ymOf(new Date()))[0])
  }

  function togglePin(bucket: string) {
    setPinnedPeriods((prev) => {
      const next = new Set(prev)
      if (next.has(bucket)) next.delete(bucket)
      else next.add(bucket)
      return next
    })
  }

  return (
    <div className="space-y-4">
      {/* 컨트롤 바 */}
      <div className="flex flex-wrap items-center gap-3">
        <SegmentGroup<ViewMode>
          label="보기"
          options={[
            { value: 'table', label: '테이블' },
            { value: 'flow', label: '흐름도' },
          ]}
          value={view}
          onChange={setView}
        />
        <SegmentGroup<Grain>
          label="기간"
          options={[
            { value: 'month', label: '월별' },
            { value: 'quarter', label: '분기별' },
            { value: 'year', label: '연도별' },
          ]}
          value={grain}
          onChange={handleGrainChange}
        />
        {/* 테이블 뷰: 기간 다중선택 + 표시 모드 */}
        {view === 'table' && (
          <>
            <CashflowPeriodPicker
              grain={grain}
              selected={selectedPeriods}
              onChange={setSelectedPeriods}
            />
            <SegmentGroup<DisplayMode>
              label="표시"
              options={[
                { value: 'group', label: '대분류' },
                { value: 'hierarchy', label: '대분류+하위' },
                { value: 'leaf', label: '하위만' },
              ]}
              value={displayMode}
              onChange={(m) => {
                setDisplayMode(m)
                setSelected(null)
              }}
            />
            <ExcludeFilter
              options={data?.leafOptions ?? []}
              excluded={excluded}
              onChange={setExcluded}
            />
            <SegmentGroup<ProfitView>
              label="손익 관점"
              options={[
                { value: 'income-statement', label: '손익계산서' },
                { value: 'contribution', label: '공헌이익' },
              ]}
              value={profitView}
              onChange={setProfitView}
            />
          </>
        )}
        {/* 흐름도 뷰: 단일 기간 선택 */}
        {view === 'flow' && (
          <Select value={flowPeriod} onValueChange={setFlowPeriod}>
            <SelectTrigger size="sm" className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {availablePeriods(grain, ymOf(new Date())).map((b) => (
                <SelectItem key={b} value={b} className="text-xs">
                  {bucketLabel(b, grain)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* 본문: 흐름도 or 테이블 */}
      {view === 'flow' ? (
        <FinanceCashflowSankey grain={grain} period={flowPeriod} />
      ) : loading ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : !data || (data.incomeRows.length === 0 && data.expenseRows.length === 0) ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 space-y-4 overflow-x-auto">
            <PnlSummaryCards metrics={data.metrics} />
            <CashflowTable
              data={data}
              mode={displayMode}
              profitView={profitView}
              pinnedPeriods={pinnedPeriods}
              onTogglePin={togglePin}
              selectedKey={selected?.key ?? null}
              onSelect={setSelected}
            />
          </div>
          {selected && (
            <CashflowTxnPanel
              selected={selected}
              from={data.from}
              to={data.to}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── 빈 상태 ─────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center shadow-sm">
      <p className="text-sm text-muted-foreground">아직 거래 내역이 없습니다.</p>
      <Button variant="outline" size="sm" asChild>
        <Link href={FINANCE_UPLOAD_PATH}>데이터 등록</Link>
      </Button>
    </div>
  )
}

// ─── 제외 계정과목 필터 ───────────────────────────────────────────────────────
// 특정 하위 계정과목을 표·손익 지표 계산에서 제외. 선택은 URL(?exclude=)에 반영.

function ExcludeFilter({
  options,
  excluded,
  onChange,
}: {
  options: LeafOption[]
  excluded: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const income = options.filter((o) => o.type === 'INCOME')
  const expense = options.filter((o) => o.type === 'EXPENSE')

  const toggle = (id: string) => {
    const next = new Set(excluded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  const renderGroup = (label: string, items: LeafOption[]) =>
    items.length === 0 ? null : (
      <div className="space-y-1">
        <p className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        {items.map((o) => (
          <label
            key={o.id}
            className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-accent"
          >
            <Checkbox checked={excluded.has(o.id)} onCheckedChange={() => toggle(o.id)} />
            <span className="truncate text-sm" title={o.name}>
              {o.name}
            </span>
            {o.parentName && (
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {o.parentName}
              </span>
            )}
          </label>
        ))}
      </div>
    )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <ListFilter className="size-3.5" />
          제외 계정과목
          {excluded.size > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[10px]">
              {excluded.size}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-medium">계산에서 제외</span>
          {excluded.size > 0 && (
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => onChange(new Set())}
            >
              초기화
            </button>
          )}
        </div>
        <div className="max-h-72 space-y-3 overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              계정과목이 없습니다.
            </p>
          ) : (
            <>
              {renderGroup('수입', income)}
              {renderGroup('지출', expense)}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── 손익 지표 요약 카드 ───────────────────────────────────────────────────────

function PnlSummaryCards({ metrics }: { metrics: PnlMetrics }) {
  const cmRatio = metrics.contributionMarginRatio.total
  const bep = metrics.breakEvenSales.total
  const cards: {
    label: string
    hint: string
    value: string
    num: number | null
    accent?: boolean
    muted?: boolean
  }[] = [
    {
      label: '매출총이익',
      hint: '매출 − 매출원가',
      value: formatWon(metrics.grossProfit.total),
      num: metrics.grossProfit.total,
    },
    {
      label: '공헌이익',
      hint:
        cmRatio == null ? '매출 − 변동비' : `매출 − 변동비 · 공헌이익율 ${formatPercent(cmRatio)}`,
      value: formatWon(metrics.contributionMargin.total),
      num: metrics.contributionMargin.total,
    },
    {
      label: '영업이익',
      hint: '매출 − 매출원가 − 영업비용',
      value: formatWon(metrics.operatingIncome.total),
      num: metrics.operatingIncome.total,
      accent: true,
    },
    {
      label: '손익분기점 매출액',
      hint: bep == null ? '공헌이익 음수 — 분기점 없음' : '고정비 / 공헌이익율',
      value: bep == null ? '산출 불가' : formatWon(bep),
      num: null,
      muted: bep == null,
    },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label} className={cn('gap-1 p-3', c.accent && 'border-primary/30')}>
          <p className="text-xs text-muted-foreground">{c.label}</p>
          <p
            className={cn(
              'font-mono font-semibold tabular-nums',
              c.muted ? 'text-sm text-muted-foreground' : 'text-lg',
              c.num != null && netValueClass(c.num)
            )}
          >
            {c.value}
          </p>
          <p className="text-[10px] text-muted-foreground">{c.hint}</p>
        </Card>
      ))}
    </div>
  )
}

// ─── 테이블 ───────────────────────────────────────────────────────────────────
// 첫 컬럼(계정과목) sticky. 핀한 기간 컬럼은 계정과목 옆에 sticky 고정(고정폭 w-[220px]/w-[160px]라 offset 정확).

function CashflowTable({
  data,
  mode,
  profitView,
  pinnedPeriods,
  onTogglePin,
  selectedKey,
  onSelect,
}: {
  data: CashflowData
  mode: DisplayMode
  profitView: ProfitView
  pinnedPeriods: Set<string>
  onTogglePin: (bucket: string) => void
  selectedKey: string | null
  onSelect: (sel: Selection) => void
}) {
  const { buckets, incomeRows, expenseRows, totals, metrics } = data
  const incomeGroups = buildCashflowGroups(incomeRows, buckets, mode)
  const expenseGroups = buildCashflowGroups(expenseRows, buckets, mode)
  const columns = buildDisplayColumns(buckets, pinnedPeriods)
  const colSpan = columns.length + 2

  return (
    <div
      className={cn(
        'w-max rounded-xl border bg-card shadow-sm',
        // 미선택(패널 없음): flex-1 래퍼 안에서 표를 가운데로. 표가 넓으면 overflow-x-auto가 스크롤(mx-auto 무효).
        selectedKey === null && 'mx-auto'
      )}
    >
      <Table className="w-max table-fixed">
        {/* 헤더 */}
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-40 w-[220px] bg-card px-4 py-3 text-xs font-medium">
              계정과목
            </TableHead>
            {columns.map((col) => (
              <TableHead
                key={col.bucket}
                className={cn(
                  'w-[160px] px-3 py-3 text-right text-xs font-medium',
                  col.pinned && 'sticky z-30 bg-card'
                )}
                style={col.pinned ? { left: col.left } : undefined}
              >
                <div className="flex items-center justify-end gap-1">
                  <span className="tabular-nums">{col.bucket}</span>
                  <button
                    type="button"
                    onClick={() => onTogglePin(col.bucket)}
                    title={col.pinned ? '고정 해제' : '컬럼 고정'}
                    className={cn(
                      'shrink-0 hover:text-foreground',
                      col.pinned ? 'text-foreground' : 'text-muted-foreground/40'
                    )}
                  >
                    <Pin className={cn('size-3.5', col.pinned && 'fill-current')} />
                  </button>
                </div>
              </TableHead>
            ))}
            <TableHead className="w-[84px] px-3 py-3 text-right text-xs font-medium text-muted-foreground">
              증감%
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {/* ── 수입 섹션 ── */}
          <SectionLabelRow label="수입" colSpan={colSpan} />
          <SectionBody
            section="수입"
            groups={incomeGroups}
            columns={columns}
            mode={mode}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
          <TotalRow label="수입 합계" entry={totals.income} columns={columns} rowBg="bg-muted/40" />

          {/* ── 지출 섹션 ── */}
          <SectionLabelRow label="지출" colSpan={colSpan} />
          <SectionBody
            section="지출"
            groups={expenseGroups}
            columns={columns}
            mode={mode}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
          <TotalRow
            label="지출 합계"
            entry={totals.expense}
            columns={columns}
            rowBg="bg-muted/40"
          />

          {/* ── 순현금흐름 ── */}
          <NetRow entry={totals.net} columns={columns} />

          {/* ── 손익 지표 (돈의 흐름: 매출 → 비용 차감 → 이익, 관점별) ── */}
          <SectionLabelRow
            label={
              profitView === 'income-statement'
                ? '손익계산서 관점 (영업매출 기준)'
                : '공헌이익 관점 (영업매출 기준)'
            }
            colSpan={colSpan}
          />
          {buildProfitFlowRows(metrics, profitView).map((r) => (
            <MetricRow key={r.label} row={r} columns={columns} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── 손익 지표 행 (돈의 흐름 계단식) ─────────────────────────────────────────
// variant: base(매출) · deduct(−차감) · subtotal(이익 소계 강조) · ratio(율)

type MetricFlowRow = {
  label: string
  hint?: string
  values: Record<string, number | null>
  variant: 'base' | 'deduct' | 'subtotal' | 'ratio'
  kind: 'won' | 'percent'
}

/** 관점별 손익 흐름 행 구성 — 매출 → 비용 차감 → 이익 소계 → 이익률. */
function buildProfitFlowRows(metrics: PnlMetrics, view: ProfitView): MetricFlowRow[] {
  const won = 'won' as const
  const percent = 'percent' as const
  if (view === 'income-statement') {
    return [
      {
        label: '매출',
        hint: '영업매출',
        values: metrics.revenue.values,
        variant: 'base',
        kind: won,
      },
      { label: '(−) 매출원가', values: metrics.cogs.values, variant: 'deduct', kind: won },
      { label: '매출총이익', values: metrics.grossProfit.values, variant: 'subtotal', kind: won },
      {
        label: '매출총이익율',
        values: metrics.grossMarginRatio.values,
        variant: 'ratio',
        kind: percent,
      },
      { label: '(−) 영업비용', values: metrics.opex.values, variant: 'deduct', kind: won },
      { label: '영업이익', values: metrics.operatingIncome.values, variant: 'subtotal', kind: won },
      {
        label: '영업이익율',
        values: metrics.operatingMarginRatio.values,
        variant: 'ratio',
        kind: percent,
      },
    ]
  }
  return [
    { label: '매출', hint: '영업매출', values: metrics.revenue.values, variant: 'base', kind: won },
    { label: '(−) 변동비', values: metrics.variableCost.values, variant: 'deduct', kind: won },
    {
      label: '공헌이익',
      values: metrics.contributionMargin.values,
      variant: 'subtotal',
      kind: won,
    },
    {
      label: '공헌이익율',
      values: metrics.contributionMarginRatio.values,
      variant: 'ratio',
      kind: percent,
    },
    { label: '(−) 고정비', values: metrics.fixedCost.values, variant: 'deduct', kind: won },
    { label: '영업이익', values: metrics.operatingIncome.values, variant: 'subtotal', kind: won },
    {
      label: '영업이익율',
      values: metrics.operatingMarginRatio.values,
      variant: 'ratio',
      kind: percent,
    },
  ]
}

function MetricRow({ row, columns }: { row: MetricFlowRow; columns: DisplayColumn[] }) {
  const { label, hint, values, variant, kind } = row
  const rowBg = variant === 'subtotal' ? 'bg-muted/30' : 'bg-card'
  const fmt = (v: number | null): string =>
    v == null ? '—' : kind === 'percent' ? formatPercent(v) : formatWon(v)
  const labelCls =
    variant === 'subtotal'
      ? 'text-sm font-semibold'
      : variant === 'ratio'
        ? 'pl-3 text-xs text-muted-foreground'
        : variant === 'deduct'
          ? 'pl-3 text-sm text-muted-foreground'
          : 'text-sm font-medium'
  const valueCls = cn(
    'w-[160px] px-3 text-right font-mono tabular-nums',
    variant === 'subtotal' ? 'text-sm font-semibold' : 'text-sm',
    variant === 'ratio' ? 'text-muted-foreground' : ''
  )
  return (
    <TableRow className={cn('hover:bg-muted/30', variant === 'subtotal' && 'border-t bg-muted/30')}>
      <TableCell className={cn('sticky left-0 z-20 w-[220px] px-4', rowBg)}>
        <div className="flex min-w-0 flex-col">
          <span className={labelCls}>{label}</span>
          {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
        </div>
      </TableCell>
      {columns.map((col) => {
        const p = pinCell(col, rowBg)
        const v = values[col.bucket] ?? null
        return (
          <TableCell
            key={col.bucket}
            className={cn(
              valueCls,
              variant === 'subtotal' && v != null && netValueClass(v),
              p.className
            )}
            style={p.style}
          >
            {variant === 'deduct' && v != null && v !== 0 ? `(${fmt(v)})` : fmt(v)}
          </TableCell>
        )
      })}
      <TableCell className="w-[84px] px-3" />
    </TableRow>
  )
}

// ─── 기간 셀 묶음(핀 sticky 처리 공유) ────────────────────────────────────────

function PeriodCells({
  columns,
  values,
  rowBg,
  cellClass,
  valueClassFn,
}: {
  columns: DisplayColumn[]
  values: Record<string, number>
  rowBg: string
  cellClass?: string
  valueClassFn?: (v: number) => string
}) {
  return (
    <>
      {columns.map((col) => {
        const p = pinCell(col, rowBg)
        return (
          <TableCell
            key={col.bucket}
            className={cn(
              'w-[160px] px-3 text-right font-mono text-sm tabular-nums',
              cellClass,
              valueClassFn?.(values[col.bucket]),
              p.className
            )}
            style={p.style}
          >
            {formatWon(values[col.bucket])}
          </TableCell>
        )
      })}
    </>
  )
}

// ─── 섹션 본문: 모드별 그룹/하위 렌더 ─────────────────────────────────────────

function SectionBody({
  section,
  groups,
  columns,
  mode,
  selectedKey,
  onSelect,
}: {
  section: '수입' | '지출'
  groups: CashflowGroup[]
  columns: DisplayColumn[]
  mode: DisplayMode
  selectedKey: string | null
  onSelect: (sel: Selection) => void
}) {
  return (
    <>
      {groups.map((g, gi) => (
        <Fragment key={g.key}>
          <GroupRow
            group={g}
            columns={columns}
            colorIdx={gi}
            section={section}
            mode={mode}
            selected={selectedKey === g.key}
            onSelect={() => onSelect(selectionFromGroup(g, section))}
          />
          {mode !== 'group' &&
            g.leaves.map((leaf) => (
              <DataRow
                key={leaf.key}
                row={leaf}
                columns={columns}
                indent
                selected={selectedKey === leaf.key}
                onSelect={() => onSelect(selectionFromLeaf(leaf))}
              />
            ))}
        </Fragment>
      ))}
    </>
  )
}

// ─── 그룹 행(대분류 / 서브그룹 헤더) ──────────────────────────────────────────

function GroupRow({
  group,
  columns,
  colorIdx,
  section,
  mode,
  selected,
  onSelect,
}: {
  group: CashflowGroup
  columns: DisplayColumn[]
  colorIdx: number
  section: '수입' | '지출'
  mode: DisplayMode
  selected: boolean
  onSelect: () => void
}) {
  const dotClass = CHART_BG_CLASSES[colorIdx % CHART_BG_CLASSES.length]
  const label = mode === 'leaf' ? `${section} · ${group.label}` : group.label
  const leafType = group.leaves[0]?.type ?? (section === '수입' ? 'INCOME' : 'EXPENSE')
  const badge = mode !== 'leaf' && group.flowRole ? flowRoleBadge(group.flowRole, leafType) : null
  const isHeader = mode !== 'group'
  // 선택 시 전 셀(첫 컬럼 + 핀 기간 셀)의 sticky 배경을 accent로 통일.
  const rowBg = selected ? 'bg-accent' : isHeader ? 'bg-muted/20' : 'bg-card'

  return (
    <TableRow
      className={cn('cursor-pointer', selected ? 'bg-accent' : isHeader && 'bg-muted/20')}
      onClick={onSelect}
    >
      <TableCell className={cn('sticky left-0 z-20 w-[220px] px-4', rowBg)}>
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn('inline-block size-2 shrink-0 rounded-full', dotClass)}
            aria-hidden="true"
          />
          <span className="truncate text-sm font-medium" title={label}>
            {label}
          </span>
          {badge && (
            <span
              className={cn(
                'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium',
                badge.className
              )}
            >
              {badge.label}
            </span>
          )}
        </div>
      </TableCell>

      <PeriodCells columns={columns} values={group.values} rowBg={rowBg} cellClass="font-medium" />

      <TableCell
        className={cn(
          'w-[84px] px-3 text-right text-xs tabular-nums',
          changePctClass(group.changePct)
        )}
      >
        {formatPercent(group.changePct, { sign: true })}
      </TableCell>
    </TableRow>
  )
}

// ─── 섹션 구분 행 ─────────────────────────────────────────────────────────────

function SectionLabelRow({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell
        colSpan={colSpan}
        className="sticky left-0 z-20 bg-muted/50 px-4 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {label}
      </TableCell>
    </TableRow>
  )
}

// ─── 데이터 행 ───────────────────────────────────────────────────────────────

function DataRow({
  row,
  columns,
  indent = false,
  selected = false,
  onSelect,
}: {
  row: CashflowRow
  columns: DisplayColumn[]
  indent?: boolean
  selected?: boolean
  onSelect?: () => void
}) {
  const rowBg = selected ? 'bg-accent' : 'bg-card'
  return (
    <TableRow
      className={cn(onSelect && 'cursor-pointer', selected && 'bg-accent')}
      onClick={onSelect}
    >
      <TableCell className={cn('sticky left-0 z-20 w-[220px] px-4', rowBg)}>
        <div className={cn('flex min-w-0 items-center gap-2', indent && 'pl-6')}>
          {indent ? (
            <span className="text-xs text-muted-foreground" aria-hidden="true">
              └
            </span>
          ) : (
            <span
              className="inline-block size-2 shrink-0 rounded-full bg-chart-1"
              aria-hidden="true"
            />
          )}
          <span className="truncate text-sm" title={row.name}>
            {row.name}
          </span>
          {row.groupLabel && (
            <span className="shrink-0 text-xs text-muted-foreground">({row.groupLabel})</span>
          )}
        </div>
      </TableCell>

      <PeriodCells columns={columns} values={row.values} rowBg={rowBg} />

      <TableCell
        className={cn(
          'w-[84px] px-3 text-right text-xs tabular-nums',
          changePctClass(row.changePct)
        )}
      >
        {formatPercent(row.changePct, { sign: true })}
      </TableCell>
    </TableRow>
  )
}

// ─── 합계 행(수입/지출) ───────────────────────────────────────────────────────

function TotalRow({
  label,
  entry,
  columns,
  rowBg,
}: {
  label: string
  entry: CashflowTotalEntry
  columns: DisplayColumn[]
  rowBg: string
}) {
  return (
    <TableRow className={cn('font-semibold hover:bg-muted/40', rowBg)}>
      <TableCell className={cn('sticky left-0 z-20 w-[220px] px-4 text-sm', rowBg)}>
        {label}
      </TableCell>

      <PeriodCells columns={columns} values={entry.values} rowBg={rowBg} />

      <TableCell
        className={cn(
          'w-[84px] px-3 text-right text-xs tabular-nums',
          changePctClass(entry.changePct)
        )}
      >
        {formatPercent(entry.changePct, { sign: true })}
      </TableCell>
    </TableRow>
  )
}

// ─── 순현금흐름 행 ────────────────────────────────────────────────────────────

function NetRow({ entry, columns }: { entry: CashflowTotalEntry; columns: DisplayColumn[] }) {
  return (
    <TableRow className="border-t-2 bg-muted/30 font-semibold hover:bg-muted/60">
      <TableCell className="sticky left-0 z-20 w-[220px] bg-muted/30 px-4 py-3 text-sm font-semibold">
        순현금흐름
      </TableCell>

      <PeriodCells
        columns={columns}
        values={entry.values}
        rowBg="bg-muted/30"
        cellClass="py-3 font-semibold"
        valueClassFn={netValueClass}
      />

      <TableCell
        className={cn(
          'w-[84px] px-3 py-3 text-right text-xs tabular-nums',
          changePctClass(entry.changePct)
        )}
      >
        {formatPercent(entry.changePct, { sign: true })}
      </TableCell>
    </TableRow>
  )
}

// ─── 우측 거래내역 패널 ───────────────────────────────────────────────────────

interface PanelTxn {
  id: string
  txnDate: string
  direction: 'IN' | 'OUT'
  amount: number
  description: string | null
  counterparty: string | null
  classStatus: FinClassStatus
  category: { name: string; parent: { name: string } | null } | null
  account: { name: string; kind: FinAccountKind }
}

interface PanelData {
  rows: PanelTxn[]
  total: number
  summary: { incomeTotal: number; expenseTotal: number; net: number }
}

/** ISO → YYYY-MM-DD(로컬). */
function fmtDate(iso: string): string {
  const d = new Date(iso)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** cashflow from/to(YYYY-MM) → transactions API 일자 경계(YYYY-MM-DD, to는 월말). */
function monthRangeToDays(from: string, to: string): { fromDay: string; toDay: string } {
  const [ty, tm] = to.split('-').map(Number)
  const lastDay = new Date(ty, tm, 0).getDate()
  return { fromDay: `${from}-01`, toDay: `${to}-${String(lastDay).padStart(2, '0')}` }
}

/** 패널 정렬 칩(일자/금액) — 활성 시 방향 화살표. */
function PanelSortChip({
  label,
  active,
  dir,
  onClick,
}: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      {label}
      {active &&
        (dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
    </button>
  )
}

/**
 * 선택된 계정과목/대분류의 거래내역(읽기 전용). 정확 계정과목 id(들) + 방향 + 기간 + 이체 제외로
 * 조회해 현금흐름 행 값과 대사되게 한다. 미분류만/혼합은 uncategorized로 처리.
 */
function CashflowTxnPanel({
  selected,
  from,
  to,
  onClose,
}: {
  selected: Selection
  from: string
  to: string
  onClose: () => void
}) {
  const [data, setData] = useState<PanelData | null>(null)
  const [loading, setLoading] = useState(true)
  // 검색·정렬(클라이언트) — 스코프된 조회 결과(≤300)를 즉시 필터/정렬.
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<'date' | 'amount'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // 대상 계정과목이 바뀌면 검색어 초기화(정렬은 유지).
  useEffect(() => {
    setSearch('')
  }, [selected.key])

  const toggleSort = (f: 'date' | 'amount') => {
    if (sortField === f) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortField(f)
      setSortDir('desc')
    }
  }

  const visibleRows = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    const filtered = q
      ? data.rows.filter(
          (r) =>
            (r.description ?? '').toLowerCase().includes(q) ||
            (r.counterparty ?? '').toLowerCase().includes(q)
        )
      : data.rows
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) =>
      sortField === 'amount'
        ? (a.amount - b.amount) * dir
        : (new Date(a.txnDate).getTime() - new Date(b.txnDate).getTime()) * dir
    )
  }, [data, search, sortField, sortDir])

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true)
      const { fromDay, toDay } = monthRangeToDays(from, to)
      const params = new URLSearchParams({
        direction: selected.direction,
        from: fromDay,
        to: toDay,
        excludeTransfer: '1',
        take: '300',
      })
      if (selected.categoryIds.length) params.set('categoryIds', selected.categoryIds.join(','))
      if (selected.uncategorized) params.set('uncategorized', '1')

      try {
        const res = await fetch(`/api/finance/transactions?${params.toString()}`, { signal })
        if (!res.ok) throw new Error('거래내역 조회 실패')
        const json: PanelData = await res.json()
        setData(json)
      } catch (err) {
        if (signal.aborted) return
        toast.error(err instanceof Error ? err.message : '거래내역 조회 실패')
        setData(null)
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    },
    [selected.categoryIds, selected.uncategorized, selected.direction, from, to]
  )

  useEffect(() => {
    const ctrl = new AbortController()
    void load(ctrl.signal)
    return () => ctrl.abort()
  }, [load])

  const isIncome = selected.direction === 'IN'
  // 검색 중이면 합계도 필터 결과(visibleRows) 기준 — 건수와 정합. 미검색 시 서버 전체 합계(대사용).
  const sum = !data
    ? 0
    : search.trim()
      ? visibleRows.reduce((s, r) => s + r.amount, 0)
      : isIncome
        ? data.summary.incomeTotal
        : data.summary.expenseTotal

  return (
    <div className="w-full shrink-0 rounded-xl border bg-card shadow-sm lg:sticky lg:top-4 lg:flex lg:h-[calc(100vh-5rem)] lg:w-[360px] lg:flex-col">
      {/* 헤더 */}
      <div className="flex shrink-0 items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                'text-xs',
                isIncome
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-400'
                  : 'border-red-200 bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-400'
              )}
            >
              {isIncome ? '수입' : '지출'}
            </Badge>
            <span className="truncate text-sm font-semibold" title={selected.title}>
              {selected.title}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {from} ~ {to}
            {data &&
              (search.trim()
                ? ` · ${visibleRows.length.toLocaleString('ko-KR')}건`
                : ` · 총 ${data.total.toLocaleString('ko-KR')}건`)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={onClose}
          aria-label="패널 닫기"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* 합계 */}
      {data && (
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-2 text-xs">
          <span className="text-muted-foreground">합계</span>
          <span
            className={cn(
              'font-mono font-medium tabular-nums',
              isIncome ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
            )}
          >
            {isIncome ? '+' : '-'}
            {formatWon(sum)}
          </span>
        </div>
      )}

      {/* 검색 + 정렬 */}
      {data && data.rows.length > 0 && (
        <div className="shrink-0 space-y-2 border-b px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="적요·가맹점 검색"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">정렬</span>
            <PanelSortChip
              label="일자"
              active={sortField === 'date'}
              dir={sortDir}
              onClick={() => toggleSort('date')}
            />
            <PanelSortChip
              label="금액"
              active={sortField === 'amount'}
              dir={sortDir}
              onClick={() => toggleSort('amount')}
            />
          </div>
        </div>
      )}

      {/* 목록 — lg에선 패널 잔여 높이를 채우고 내부 스크롤(패널 자체는 sticky 고정) */}
      <div className="max-h-[60vh] overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중...</p>
        ) : !data || data.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">거래 내역이 없습니다</p>
        ) : visibleRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">검색 결과가 없습니다</p>
        ) : (
          <ul className="divide-y">
            {visibleRows.map((txn) => {
              const status = classStatusBadge(txn.classStatus)
              return (
                <li key={txn.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {fmtDate(txn.txnDate)}
                    </span>
                    <span
                      className={cn(
                        'font-mono text-xs font-medium tabular-nums',
                        isIncome
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      )}
                    >
                      {isIncome ? '+' : '-'}
                      {formatWon(txn.amount)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs" title={txn.description ?? ''}>
                    {txn.description ?? txn.counterparty ?? '-'}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                      <span className="text-muted-foreground">
                        {accountKindLabel(txn.account.kind)}
                      </span>
                      <span className="font-medium">{txn.account.name}</span>
                    </span>
                    {txn.category ? (
                      <span className="truncate text-[10px] text-muted-foreground">
                        {txn.category.name}
                      </span>
                    ) : (
                      <Badge variant="outline" className={cn('text-[10px]', status.className)}>
                        {status.label}
                      </Badge>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
