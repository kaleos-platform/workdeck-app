'use client'

import { Fragment, useCallback, useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Pin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatWon, formatPercent, flowRoleBadge } from '@/components/finance/format'
import { FinanceCashflowSankey } from '@/components/finance/cashflow-sankey'
import { CashflowPeriodPicker } from '@/components/finance/cashflow-period-picker'
import {
  buildCashflowGroups,
  type CashflowLeaf,
  type CashflowGroup,
  type DisplayMode,
} from '@/lib/finance/cashflow-grouping'
import { ymOf } from '@/lib/finance/aggregate'
import { defaultSelectedPeriods, type Grain } from '@/lib/finance/periods'
import { FINANCE_UPLOAD_PATH } from '@/lib/deck-routes'

// ─── 타입 ────────────────────────────────────────────────────────────────────

type ViewMode = 'table' | 'flow'

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
  const [displayMode, setDisplayMode] = useState<DisplayMode>('group')
  // 표시 기간(오름차순) — 기본은 직전월까지 최근 N. grain 변경 시 리셋.
  const [selectedPeriods, setSelectedPeriods] = useState<string[]>(() =>
    defaultSelectedPeriods('month', ymOf(new Date()))
  )
  const [pinnedPeriods, setPinnedPeriods] = useState<Set<string>>(new Set())
  const [data, setData] = useState<CashflowData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (g: Grain, periods: string[]) => {
    if (periods.length === 0) return
    setLoading(true)
    try {
      const qs = new URLSearchParams({ grain: g, periods: periods.join(',') })
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
    void load(grain, selectedPeriods)
  }, [load, grain, selectedPeriods])

  // grain 변경: 기본 기간으로 리셋 + 핀 초기화.
  function handleGrainChange(g: Grain) {
    setGrain(g)
    setSelectedPeriods(defaultSelectedPeriods(g, ymOf(new Date())))
    setPinnedPeriods(new Set())
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
              onChange={setDisplayMode}
            />
          </>
        )}
      </div>

      {/* 본문: 흐름도 or 테이블 */}
      {view === 'flow' ? (
        <FinanceCashflowSankey grain={grain} />
      ) : loading ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : !data || (data.incomeRows.length === 0 && data.expenseRows.length === 0) ? (
        <EmptyState />
      ) : (
        <CashflowTable
          data={data}
          mode={displayMode}
          pinnedPeriods={pinnedPeriods}
          onTogglePin={togglePin}
        />
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

// ─── 테이블 ───────────────────────────────────────────────────────────────────
// 첫 컬럼(계정과목) sticky. 핀한 기간 컬럼은 계정과목 옆에 sticky 고정(고정폭 w-[220px]/w-[160px]라 offset 정확).

function CashflowTable({
  data,
  mode,
  pinnedPeriods,
  onTogglePin,
}: {
  data: CashflowData
  mode: DisplayMode
  pinnedPeriods: Set<string>
  onTogglePin: (bucket: string) => void
}) {
  const { buckets, incomeRows, expenseRows, totals } = data
  const incomeGroups = buildCashflowGroups(incomeRows, buckets, mode)
  const expenseGroups = buildCashflowGroups(expenseRows, buckets, mode)
  const columns = buildDisplayColumns(buckets, pinnedPeriods)
  const colSpan = columns.length + 2

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <Table className="w-auto table-fixed">
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
          <SectionBody section="수입" groups={incomeGroups} columns={columns} mode={mode} />
          <TotalRow label="수입 합계" entry={totals.income} columns={columns} rowBg="bg-muted/40" />

          {/* ── 지출 섹션 ── */}
          <SectionLabelRow label="지출" colSpan={colSpan} />
          <SectionBody section="지출" groups={expenseGroups} columns={columns} mode={mode} />
          <TotalRow label="지출 합계" entry={totals.expense} columns={columns} rowBg="bg-muted/40" />

          {/* ── 순현금흐름 ── */}
          <NetRow entry={totals.net} columns={columns} />
        </TableBody>
      </Table>
    </div>
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
}: {
  section: '수입' | '지출'
  groups: CashflowGroup[]
  columns: DisplayColumn[]
  mode: DisplayMode
}) {
  return (
    <>
      {groups.map((g, gi) => (
        <Fragment key={g.key}>
          <GroupRow group={g} columns={columns} colorIdx={gi} section={section} mode={mode} />
          {mode !== 'group' &&
            g.leaves.map((leaf) => (
              <DataRow key={leaf.key} row={leaf} columns={columns} indent />
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
}: {
  group: CashflowGroup
  columns: DisplayColumn[]
  colorIdx: number
  section: '수입' | '지출'
  mode: DisplayMode
}) {
  const dotClass = CHART_BG_CLASSES[colorIdx % CHART_BG_CLASSES.length]
  const label = mode === 'leaf' ? `${section} · ${group.label}` : group.label
  const leafType = group.leaves[0]?.type ?? (section === '수입' ? 'INCOME' : 'EXPENSE')
  const badge = mode !== 'leaf' && group.flowRole ? flowRoleBadge(group.flowRole, leafType) : null
  const isHeader = mode !== 'group'
  const rowBg = isHeader ? 'bg-muted/20' : 'bg-card'

  return (
    <TableRow className={cn(isHeader && 'bg-muted/20')}>
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
        className={cn('w-[84px] px-3 text-right text-xs tabular-nums', changePctClass(group.changePct))}
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
}: {
  row: CashflowRow
  columns: DisplayColumn[]
  indent?: boolean
}) {
  return (
    <TableRow>
      <TableCell className="sticky left-0 z-20 w-[220px] bg-card px-4">
        <div className={cn('flex min-w-0 items-center gap-2', indent && 'pl-6')}>
          {indent ? (
            <span className="text-xs text-muted-foreground" aria-hidden="true">
              └
            </span>
          ) : (
            <span className="inline-block size-2 shrink-0 rounded-full bg-chart-1" aria-hidden="true" />
          )}
          <span className="truncate text-sm" title={row.name}>
            {row.name}
          </span>
          {row.groupLabel && (
            <span className="shrink-0 text-xs text-muted-foreground">({row.groupLabel})</span>
          )}
        </div>
      </TableCell>

      <PeriodCells columns={columns} values={row.values} rowBg="bg-card" />

      <TableCell
        className={cn('w-[84px] px-3 text-right text-xs tabular-nums', changePctClass(row.changePct))}
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
      <TableCell className={cn('sticky left-0 z-20 w-[220px] px-4 text-sm', rowBg)}>{label}</TableCell>

      <PeriodCells columns={columns} values={entry.values} rowBg={rowBg} />

      <TableCell
        className={cn('w-[84px] px-3 text-right text-xs tabular-nums', changePctClass(entry.changePct))}
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
        className={cn('w-[84px] px-3 py-3 text-right text-xs tabular-nums', changePctClass(entry.changePct))}
      >
        {formatPercent(entry.changePct, { sign: true })}
      </TableCell>
    </TableRow>
  )
}
