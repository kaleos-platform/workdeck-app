'use client'

/**
 * 현금흐름 테이블 기간 다중선택 피커 — Popover + 체크박스 + 프리셋.
 * 비연속 선택 가능(예 2025-06 vs 2026-06). 최대 MAX_PERIODS[grain]개까지(가독성·가로 스크롤).
 */
import { useMemo } from 'react'
import { CalendarRange } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ymOf } from '@/lib/finance/aggregate'
import { availablePeriods, MAX_PERIODS, type Grain } from '@/lib/finance/periods'

const PRESETS: Record<Grain, { label: string; count: number }[]> = {
  month: [
    { label: '최근 3개월', count: 3 },
    { label: '최근 6개월', count: 6 },
    { label: '최근 12개월', count: 12 },
  ],
  quarter: [
    { label: '최근 4분기', count: 4 },
    { label: '최근 8분기', count: 8 },
  ],
  year: [
    { label: '최근 3년', count: 3 },
    { label: '최근 5년', count: 5 },
  ],
}

export function CashflowPeriodPicker({
  grain,
  selected,
  onChange,
}: {
  grain: Grain
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const max = MAX_PERIODS[grain]
  const options = useMemo(() => availablePeriods(grain, ymOf(new Date())), [grain])

  function toggle(bucket: string) {
    if (selected.includes(bucket)) {
      if (selected.length <= 1) return // 최소 1개 유지(빈 선택 방지)
      onChange(selected.filter((b) => b !== bucket))
    } else {
      if (selected.length >= max) return // 캡 초과 방지
      onChange([...selected, bucket].sort())
    }
  }

  function applyPreset(count: number) {
    // 최신순 목록에서 count개(캡 이내) → 오름차순.
    onChange(options.slice(0, Math.min(count, max)).slice().reverse())
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <CalendarRange className="size-3.5" />
          기간 {selected.length}개
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        {/* 프리셋 */}
        <div className="flex flex-wrap gap-1 border-b p-2">
          {PRESETS[grain].map((p) => (
            <Button
              key={p.label}
              variant="secondary"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => applyPreset(p.count)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {/* 체크박스 목록 */}
        <div className="max-h-64 overflow-y-auto p-1">
          {options.map((bucket) => {
            const checked = selected.includes(bucket)
            const disabled =
              (!checked && selected.length >= max) || (checked && selected.length <= 1)
            return (
              <label
                key={bucket}
                className={cnRow(disabled)}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={() => toggle(bucket)}
                />
                <span className="font-mono text-xs tabular-nums">{bucket}</span>
              </label>
            )
          })}
        </div>
        {/* 캡 안내 */}
        <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          선택 {selected.length} / 최대 {max}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function cnRow(disabled: boolean): string {
  return [
    'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-accent',
    disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
  ]
    .filter(Boolean)
    .join(' ')
}
