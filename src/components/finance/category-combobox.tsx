'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, CornerDownRight, Plus } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { comboOptionLabel, type ComboOption } from '@/lib/finance/category-options'

type CategoryComboboxProps = {
  options: ComboOption[]
  value: string | null
  onChange: (id: string) => void
  placeholder?: string
  /** 트리거 크기/폭 등 소비처별 클래스 */
  triggerClassName?: string
  /** 검색 입력 placeholder */
  searchPlaceholder?: string
  /** 지정 시 목록 하단(필터 비대상)에 추가 버튼 노출. 클릭 시 popover를 닫고 호출. */
  onAddNew?: () => void
  addNewLabel?: string
  disabled?: boolean
}

/**
 * 검색형 계정과목 선택기. 평면 목록 + 상위/하위 시각 구분(상위=그룹 배지, 하위=들여쓰기+상위명).
 * 검색은 이름/상위명/그룹명 매칭(cmdk keywords). 백엔드/동작 무관 — 선택 UI만 담당.
 */
export function CategoryCombobox({
  options,
  value,
  onChange,
  placeholder = '계정과목 선택',
  triggerClassName,
  searchPlaceholder = '검색...',
  onAddNew,
  addNewLabel = '계정과목 추가',
  disabled,
}: CategoryComboboxProps) {
  const [open, setOpen] = React.useState(false)
  // 라벨은 전체 옵션에서 해석(비활성 항목에 이미 분류된 거래의 표시 보존).
  const selectedLabel = comboOptionLabel(options, value)
  // 목록은 비활성 항목을 숨겨 새 선택을 막되, 현재 선택값은 유지(라벨·체크 표시).
  const visibleOptions = options.filter((o) => o.isActive !== false || o.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'flex items-center justify-between gap-1 rounded-md border border-input bg-transparent px-3 text-left shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            triggerClassName
          )}
        >
          <span className={cn('truncate', !selectedLabel && 'text-muted-foreground')}>
            {selectedLabel || placeholder}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>일치하는 계정과목이 없습니다</CommandEmpty>
            {visibleOptions.map((opt) => (
              <CommandItem
                key={opt.id}
                value={opt.id}
                keywords={opt.keywords}
                onSelect={() => {
                  onChange(opt.id)
                  setOpen(false)
                }}
                className={cn(
                  'text-xs',
                  opt.indent && 'pl-5',
                  opt.isActive === false && 'opacity-60'
                )}
              >
                {opt.indent && (
                  <CornerDownRight className="size-3 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                {opt.isActive === false && (
                  <Badge
                    variant="outline"
                    className="shrink-0 px-1.5 text-[10px] text-muted-foreground"
                  >
                    비활성
                  </Badge>
                )}
                {opt.hint && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">({opt.hint})</span>
                )}
                {opt.badge && (
                  <Badge
                    variant="outline"
                    className={cn('shrink-0 px-1.5 text-[10px]', opt.badge.className)}
                  >
                    {opt.badge.label}
                  </Badge>
                )}
                {value === opt.id && <Check className="size-3.5 shrink-0" />}
              </CommandItem>
            ))}
          </CommandList>
          {onAddNew && (
            <div className="border-t p-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onAddNew()
                }}
                className="flex w-full items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-primary hover:bg-accent"
              >
                <Plus className="size-3.5" />
                {addNewLabel}
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
