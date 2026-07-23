'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, CornerDownRight, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { comboOptionLabel, type ComboOption } from '@/lib/finance/category-options'
import type { FinCategoryType } from '@/generated/prisma/enums'

/** 분류 탭(수익/비용/이체) — 단일 콤보와 동일 표기. */
const TYPE_TABS: { type: FinCategoryType; label: string }[] = [
  { type: 'INCOME', label: '수익' },
  { type: 'EXPENSE', label: '비용' },
  { type: 'TRANSFER', label: '이체' },
]

type CategoryMultiComboboxProps = {
  options: ComboOption[]
  /** 선택된 옵션 id 배열(대분류/리프/미분류 sentinel 혼재 가능). */
  value: string[]
  onChange: (ids: string[]) => void
  /** popover 닫힘 시 호출 — 소비처가 재조회를 트리거(선택은 닫을 때 일괄 반영). */
  onClose?: () => void
  placeholder?: string
  triggerClassName?: string
  searchPlaceholder?: string
  groupByType?: boolean
  defaultType?: FinCategoryType
  disabled?: boolean
}

/**
 * 검색형 계정과목 **다중 선택** 필터. 단일 CategoryCombobox와 달리 체크박스로 여러 개를 고르고
 * 선택 후에도 popover가 열린 채 유지된다. 대분류를 고르면 그 그룹 전체(서버가 자손 리프로 확장),
 * 리프/미분류(sentinel)도 개별 선택 가능. 트리거는 선택 개수 요약, 목록 하단에 "전체 해제".
 * 분류(리프 배정)용 단일 콤보를 오염시키지 않기 위해 별도 컴포넌트로 분리한다.
 */
export function CategoryMultiCombobox({
  options,
  value,
  onChange,
  onClose,
  placeholder = '전체 계정과목',
  triggerClassName,
  searchPlaceholder = '검색...',
  groupByType,
  defaultType,
  disabled,
}: CategoryMultiComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const selectedSet = React.useMemo(() => new Set(value), [value])

  const resolveInitialType = React.useCallback((): FinCategoryType => {
    // 이미 고른 항목의 타입을 우선 활성 탭으로, 없으면 방향 기본/수익.
    const firstTyped = value
      .map((id) => options.find((o) => o.id === id)?.type)
      .find((t): t is FinCategoryType => !!t)
    return firstTyped ?? defaultType ?? 'INCOME'
  }, [value, options, defaultType])
  const [activeType, setActiveType] = React.useState<FinCategoryType>(resolveInitialType)

  // 트리거 라벨: 0=placeholder, 1=해당 라벨, N=요약.
  const triggerLabel =
    value.length === 0
      ? ''
      : value.length === 1
        ? comboOptionLabel(options, value[0]) || '1개 선택'
        : `${value.length}개 선택`

  // 목록: 비활성 숨김(단 현재 선택값은 유지), groupByType이면 활성 탭 + type 없는 옵션(미분류) 항상.
  const base = options.filter((o) => o.isActive !== false || selectedSet.has(o.id))
  const visibleOptions =
    groupByType && !query.trim()
      ? base.filter((o) => o.type === activeType || o.type == null)
      : base

  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(value.filter((v) => v !== id))
    else onChange([...value, id])
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setActiveType(resolveInitialType())
          setQuery('')
        } else {
          // 닫힐 때 재조회(선택 일괄 반영).
          onClose?.()
        }
      }}
    >
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
          <span className={cn('truncate', !triggerLabel && 'text-muted-foreground')}>
            {triggerLabel || placeholder}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          {groupByType && (
            <div className="flex gap-1 border-b p-1">
              {TYPE_TABS.map((t) => (
                <button
                  key={t.type}
                  type="button"
                  onClick={() => {
                    setActiveType(t.type)
                    setQuery('')
                  }}
                  className={cn(
                    'flex-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors',
                    activeType === t.type
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <CommandInput placeholder={searchPlaceholder} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>일치하는 계정과목이 없습니다</CommandEmpty>
            {visibleOptions.map((opt) => {
              const checked = selectedSet.has(opt.id)
              return (
                <CommandItem
                  key={opt.id}
                  value={opt.id}
                  keywords={opt.keywords}
                  // cmdk가 선택 후 자동으로 닫지 않도록 onSelect에서 popover를 유지.
                  onSelect={() => toggle(opt.id)}
                  className={cn(
                    'text-xs',
                    opt.indent && 'pl-5',
                    opt.isActive === false && 'opacity-60'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                      checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                    )}
                  >
                    {checked && <Check className="size-3" />}
                  </span>
                  {opt.indent && <CornerDownRight className="size-3 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                  {opt.isActive === false && (
                    <Badge variant="outline" className="shrink-0 px-1.5 text-[10px] text-muted-foreground">
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
                </CommandItem>
              )
            })}
          </CommandList>
          {value.length > 0 && (
            <div className="border-t p-1">
              <button
                type="button"
                onClick={() => onChange([])}
                className="flex w-full items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                <X className="size-3.5" />
                전체 해제 ({value.length})
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
