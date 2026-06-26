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
  const selectedLabel = comboOptionLabel(options, value)

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
            {options.map((opt) => (
              <CommandItem
                key={opt.id}
                value={opt.id}
                keywords={opt.keywords}
                onSelect={() => {
                  onChange(opt.id)
                  setOpen(false)
                }}
                className={cn('text-xs', opt.indent && 'pl-5')}
              >
                {opt.indent && (
                  <CornerDownRight className="size-3 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{opt.label}</span>
                {opt.hint && (
                  <span className="truncate text-[10px] text-muted-foreground">({opt.hint})</span>
                )}
                {opt.badge && (
                  <Badge
                    variant="outline"
                    className={cn('ml-auto shrink-0 px-1.5 text-[10px]', opt.badge.className)}
                  >
                    {opt.badge.label}
                  </Badge>
                )}
                {value === opt.id && (
                  <Check className={cn('size-3.5 shrink-0', !opt.badge && 'ml-auto')} />
                )}
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
