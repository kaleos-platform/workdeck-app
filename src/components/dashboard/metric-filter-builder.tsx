'use client'

import { useState, type ReactNode } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  METRIC_KEYS,
  METRIC_LABELS,
  METRIC_UNIT,
  OP_KEYS,
  OP_LABELS,
  type FilterOp,
  type MetricCondition,
  type MetricKey,
} from '@/lib/coupang-ads/metric-filter'

type DraftRow = { metric: MetricKey; op: FilterOp; valueStr: string }

function toDraft(conds: MetricCondition[]): DraftRow[] {
  return conds.map((c) => ({ metric: c.metric, op: c.op, valueStr: String(c.value) }))
}

type Props = {
  value: MetricCondition[]
  onApply: (next: MetricCondition[]) => void
  className?: string
  /** 커스텀 트리거(예: 프리셋 편집 연필). 미지정 시 기본 "커스텀 필터" 버튼+badge. */
  trigger?: ReactNode
  /** 팝오버 제목. 기본 "필터 조건 (모두 만족 · AND)". */
  title?: string
  /** 노출·선택 가능 메트릭. 기본 전체(METRIC_KEYS). 광고데이터=RECORD_METRIC_KEYS. */
  allowedMetrics?: MetricKey[]
  /** "초기화"가 되돌릴 조건. 기본 [](비활성). 프리셋 편집=seed 기본값. */
  resetTo?: MetricCondition[]
}

export function MetricFilterBuilder({
  value,
  onApply,
  className,
  trigger,
  title = '필터 조건 (모두 만족 · AND)',
  allowedMetrics = METRIC_KEYS,
  resetTo = [],
}: Props) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<DraftRow[]>(toDraft(value))
  const defaultMetric = allowedMetrics[0] ?? 'roas'

  // 팝오버 열 때 현재 적용값으로 draft 리셋 (effect 아닌 이벤트에서 처리)
  function handleOpenChange(next: boolean) {
    if (next) setRows(toDraft(value))
    setOpen(next)
  }

  function updateRow(idx: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  function addRow() {
    setRows((prev) => [...prev, { metric: defaultMetric, op: 'lt', valueStr: '' }])
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx))
  }

  function apply() {
    const next: MetricCondition[] = rows
      .filter((r) => r.valueStr.trim() !== '' && Number.isFinite(Number(r.valueStr)))
      .map((r) => ({ metric: r.metric, op: r.op, value: Number(r.valueStr) }))
    onApply(next)
    setOpen(false)
  }

  function reset() {
    setRows(toDraft(resetTo))
    onApply(resetTo)
    setOpen(false)
  }

  const activeCount = value.length

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className={className}>
            <SlidersHorizontal className="mr-1 h-4 w-4" />
            커스텀 필터
            {activeCount > 0 && (
              <Badge variant="secondary" className="ml-1.5 px-1.5">
                {activeCount}
              </Badge>
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[380px] p-3">
        <div className="space-y-2">
          <p className="text-sm font-medium">{title}</p>

          {rows.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              조건이 없습니다. 아래에서 조건을 추가하세요.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <Select
                    value={row.metric}
                    onValueChange={(v) => updateRow(idx, { metric: v as MetricKey })}
                  >
                    <SelectTrigger size="sm" className="w-[110px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {allowedMetrics.map((m) => (
                        <SelectItem key={m} value={m}>
                          {METRIC_LABELS[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={row.op}
                    onValueChange={(v) => updateRow(idx, { op: v as FilterOp })}
                  >
                    <SelectTrigger size="sm" className="w-[76px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OP_KEYS.map((o) => (
                        <SelectItem key={o} value={o}>
                          {OP_LABELS[o]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="relative flex-1">
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={row.valueStr}
                      onChange={(e) => updateRow(idx, { valueStr: e.target.value })}
                      className="h-8 pr-7 text-right"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">
                      {METRIC_UNIT[row.metric]}
                    </span>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => removeRow(idx)}
                    aria-label="조건 삭제"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button variant="outline" size="sm" className="w-full" onClick={addRow}>
            + 조건 추가
          </Button>

          <div className="flex justify-between gap-2 border-t pt-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              초기화
            </Button>
            <Button size="sm" onClick={apply}>
              적용
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
