'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
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
import { formatWon, formatPercent } from '@/components/finance/format'
import { FinanceCashflowSankey } from '@/components/finance/cashflow-sankey'
import { FINANCE_UPLOAD_PATH } from '@/lib/deck-routes'

// ─── 타입 ────────────────────────────────────────────────────────────────────

type Grain = 'month' | 'quarter' | 'year'
type GroupBy = 'category' | 'subaccount'
type ViewMode = 'table' | 'flow'

interface CashflowRow {
  key: string
  name: string
  type: 'INCOME' | 'EXPENSE'
  groupLabel: string | null
  values: Record<string, number>
  changePct: number | null
}

interface CashflowTotalEntry {
  values: Record<string, number>
  changePct: number | null
}

interface CashflowData {
  grain: Grain
  groupBy: GroupBy
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
  const [groupBy, setGroupBy] = useState<GroupBy>('category')
  const [data, setData] = useState<CashflowData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (g: Grain, gb: GroupBy) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ grain: g, groupBy: gb })
      const res = await fetch(`/api/finance/cashflow?${params.toString()}`)
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
    void load(grain, groupBy)
  }, [load, grain, groupBy])

  // grain 변경 핸들러
  function handleGrainChange(g: Grain) {
    setGrain(g)
  }

  // groupBy 변경 핸들러
  function handleGroupByChange(gb: GroupBy) {
    setGroupBy(gb)
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
        {/* 구분(계정과목/사용자계정)은 테이블 뷰에서만 — 흐름도는 대분류 기준 롤업 고정 */}
        {view === 'table' && (
          <SegmentGroup<GroupBy>
            label="구분"
            options={[
              { value: 'category', label: '계정과목' },
              { value: 'subaccount', label: '사용자 계정' },
            ]}
            value={groupBy}
            onChange={handleGroupByChange}
          />
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
        <CashflowTable data={data} />
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

function CashflowTable({ data }: { data: CashflowData }) {
  const { buckets, incomeRows, expenseRows, totals } = data

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <Table>
        {/* 헤더 */}
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {/* 첫 컬럼: sticky */}
            <TableHead className="sticky left-0 z-20 min-w-[180px] bg-card px-4 py-3 text-xs font-medium">
              계정과목
            </TableHead>
            {buckets.map((b) => (
              <TableHead key={b} className="min-w-[120px] px-3 py-3 text-right text-xs font-medium">
                {b}
              </TableHead>
            ))}
            <TableHead className="min-w-[80px] px-3 py-3 text-right text-xs font-medium text-muted-foreground">
              증감%
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {/* ── 수입 섹션 ── */}
          <SectionLabelRow label="수입" colSpan={buckets.length + 2} />

          {incomeRows.map((row, idx) => (
            <DataRow key={row.key} row={row} buckets={buckets} colorIdx={idx} />
          ))}

          {/* 수입 합계 */}
          <TotalRow
            label="수입 합계"
            entry={totals.income}
            buckets={buckets}
            className="bg-muted/40 font-semibold"
          />

          {/* ── 지출 섹션 ── */}
          <SectionLabelRow label="지출" colSpan={buckets.length + 2} />

          {expenseRows.map((row, idx) => (
            <DataRow key={row.key} row={row} buckets={buckets} colorIdx={idx} />
          ))}

          {/* 지출 합계 */}
          <TotalRow
            label="지출 합계"
            entry={totals.expense}
            buckets={buckets}
            className="bg-muted/40 font-semibold"
          />

          {/* ── 순현금흐름 ── */}
          <NetRow entry={totals.net} buckets={buckets} />
        </TableBody>
      </Table>
    </div>
  )
}

// ─── 섹션 구분 행 ─────────────────────────────────────────────────────────────

function SectionLabelRow({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell
        colSpan={colSpan}
        className="sticky left-0 z-10 bg-muted/50 px-4 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {label}
      </TableCell>
    </TableRow>
  )
}

// ─── 데이터 행 ───────────────────────────────────────────────────────────────

function DataRow({
  row,
  buckets,
  colorIdx,
}: {
  row: CashflowRow
  buckets: string[]
  colorIdx: number
}) {
  const dotClass = CHART_BG_CLASSES[colorIdx % CHART_BG_CLASSES.length]

  return (
    <TableRow>
      {/* sticky 첫 컬럼 */}
      <TableCell className="sticky left-0 z-10 bg-card px-4">
        <div className="flex items-center gap-2">
          <span
            className={cn('inline-block size-2 shrink-0 rounded-full', dotClass)}
            aria-hidden="true"
          />
          <span className="text-sm">{row.name}</span>
          {row.groupLabel && (
            <span className="text-xs text-muted-foreground">({row.groupLabel})</span>
          )}
        </div>
      </TableCell>

      {/* 버킷 금액 */}
      {buckets.map((b) => (
        <TableCell key={b} className="px-3 text-right font-mono text-sm tabular-nums">
          {formatWon(row.values[b])}
        </TableCell>
      ))}

      {/* 증감% */}
      <TableCell
        className={cn('px-3 text-right text-xs tabular-nums', changePctClass(row.changePct))}
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
  buckets,
  className,
}: {
  label: string
  entry: CashflowTotalEntry
  buckets: string[]
  className?: string
}) {
  return (
    <TableRow className={cn('hover:bg-muted/40', className)}>
      {/* sticky 첫 컬럼 */}
      <TableCell className={cn('sticky left-0 z-10 px-4 text-sm', className)}>{label}</TableCell>

      {buckets.map((b) => (
        <TableCell key={b} className="px-3 text-right font-mono text-sm tabular-nums">
          {formatWon(entry.values[b])}
        </TableCell>
      ))}

      <TableCell
        className={cn('px-3 text-right text-xs tabular-nums', changePctClass(entry.changePct))}
      >
        {formatPercent(entry.changePct, { sign: true })}
      </TableCell>
    </TableRow>
  )
}

// ─── 순현금흐름 행 ────────────────────────────────────────────────────────────

function NetRow({ entry, buckets }: { entry: CashflowTotalEntry; buckets: string[] }) {
  return (
    <TableRow className="border-t-2 bg-muted/30 font-semibold hover:bg-muted/60">
      {/* sticky 첫 컬럼 */}
      <TableCell className="sticky left-0 z-10 bg-muted/30 px-4 py-3 text-sm font-semibold">
        순현금흐름
      </TableCell>

      {buckets.map((b) => (
        <TableCell
          key={b}
          className={cn(
            'px-3 py-3 text-right font-mono text-sm font-semibold tabular-nums',
            netValueClass(entry.values[b])
          )}
        >
          {formatWon(entry.values[b])}
        </TableCell>
      ))}

      <TableCell
        className={cn('px-3 py-3 text-right text-xs tabular-nums', changePctClass(entry.changePct))}
      >
        {formatPercent(entry.changePct, { sign: true })}
      </TableCell>
    </TableRow>
  )
}
