'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  SALES_MIX_THRESHOLDS as T,
  type SalesMixProductRow,
  type SalesMixStatus,
} from '@/lib/coupang-ads/sales-mix'

export const fmtWon = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`
export const fmtPct = (ratio: number | null) =>
  ratio === null ? '—' : `${Math.round(ratio * 100).toLocaleString('ko-KR')}%`
const fmtPp = (pp: number | null) => (pp === null ? '—' : `${pp > 0 ? '+' : ''}${pp.toFixed(1)}%p`)
const fmtChange = (pct: number | null) =>
  pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`

export const STATUS_META: Record<SalesMixStatus, { label: string; tip: string; cls: string }> = {
  organic: {
    label: '광고 없이 판매',
    tip: `광고비 비중 ${T.organicMaxAdShare * 100}% 이하 · 하루 평균 ${T.organicMinDailyQty}개 이상`,
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  },
  dependent: {
    label: '광고 의존',
    tip: `광고비 비중 ${T.dependentMinAdShare * 100}% 이상`,
    cls: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  },
  neutral: {
    label: '중간',
    tip: '광고 없이 판매·광고 의존 어디에도 해당하지 않음',
    cls: 'bg-muted text-muted-foreground',
  },
}

type SortKey =
  | 'revenue'
  | 'salesQty'
  | 'adCost'
  | 'adShare'
  | 'adShareDeltaPp'
  | 'revenueChangePct'
  | 'coupangAdRevenueShare'

const COLUMNS: { key: SortKey; label: string; render: (r: SalesMixProductRow) => string }[] = [
  { key: 'revenue', label: '전체 매출', render: (r) => fmtWon(r.revenue) },
  { key: 'salesQty', label: '판매수량', render: (r) => r.salesQty.toLocaleString('ko-KR') },
  { key: 'adCost', label: '광고비', render: (r) => fmtWon(r.adCost) },
  { key: 'adShare', label: '광고비 비중', render: (r) => fmtPct(r.adShare) },
  { key: 'adShareDeltaPp', label: '비중 변화(%p)', render: (r) => fmtPp(r.adShareDeltaPp) },
  { key: 'revenueChangePct', label: '매출 변화(%)', render: (r) => fmtChange(r.revenueChangePct) },
  {
    key: 'coupangAdRevenueShare',
    label: '쿠팡 기준 광고매출 비중',
    render: (r) => fmtPct(r.coupangAdRevenueShare),
  },
]

export function SalesMixTable({
  rows,
  onSelect,
  selectedId,
}: {
  rows: SalesMixProductRow[]
  onSelect: (productId: string) => void
  selectedId?: string | null
}) {
  const [includeZero, setIncludeZero] = useState(false)
  const [filter, setFilter] = useState<SalesMixStatus | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'revenue', desc: true })

  const count = (s: SalesMixStatus) => rows.filter((r) => r.status === s).length

  const visible = useMemo(() => {
    const list = rows.filter(
      (r) => (includeZero || r.revenue !== 0 || r.adCost !== 0) && (!filter || r.status === filter)
    )
    // null 은 정렬 방향과 무관하게 맨 뒤
    return list.sort((a, b) => {
      const x = a[sort.key]
      const y = b[sort.key]
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
      return sort.desc ? y - x : x - y
    })
  }, [rows, includeZero, filter, sort])

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['organic', 'dependent'] as const).map((s) => (
          <Button
            key={s}
            variant={filter === s ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setFilter((f) => (f === s ? null : s))}
          >
            {STATUS_META[s].label} {count(s)}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <Checkbox
            id="sales-mix-include-zero"
            checked={includeZero}
            onCheckedChange={(v) => setIncludeZero(v === true)}
          />
          <Label htmlFor="sales-mix-include-zero" className="text-xs font-normal">
            매출 0 포함
          </Label>
        </div>
      </div>

      <div className="max-h-[640px] overflow-auto rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="min-w-[220px]">상품명</TableHead>
              {COLUMNS.map((c) => (
                <TableHead key={c.key} className="text-right">
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 hover:text-foreground"
                    onClick={() => toggleSort(c.key)}
                  >
                    {c.label}
                    {sort.key === c.key &&
                      (sort.desc ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ArrowUp className="h-3 w-3" />
                      ))}
                  </button>
                </TableHead>
              ))}
              <TableHead>상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMNS.length + 2}
                  className="py-8 text-center text-muted-foreground"
                >
                  표시할 상품이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              visible.map((r) => {
                const id = r.productId
                const meta = STATUS_META[r.status]
                return (
                  <TableRow
                    key={id ?? '__none__'}
                    data-state={id && id === selectedId ? 'selected' : undefined}
                    className={cn(id && 'cursor-pointer')}
                    onClick={id ? () => onSelect(id) : undefined}
                  >
                    <TableCell className="whitespace-normal">{r.productName}</TableCell>
                    {COLUMNS.map((c) => (
                      <TableCell key={c.key} className="text-right tabular-nums">
                        {c.render(r)}
                      </TableCell>
                    ))}
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={cn('rounded-full px-2 py-0.5 text-xs font-medium', meta.cls)}
                          >
                            {meta.label}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{meta.tip}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
