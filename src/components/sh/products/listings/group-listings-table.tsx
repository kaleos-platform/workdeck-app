'use client'

import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { computeDiscount } from '@/lib/sh/listing-calc'

export type GroupListingRow = {
  id: string
  searchName: string
  displayName: string
  managementName: string | null
  internalCode: string | null
  status: 'ACTIVE' | 'SUSPENDED'
  effectiveStatus: 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'
  retailPrice: number | null
  baselinePrice: number | null
  discountAmount: number | null
  discountPercent: number | null
  channelAllocation: number | null
  availableStock: number
  autoAvailableStock: number
  items: Array<{
    optionId: string
    optionName: string
    sku: string | null
    quantity: number
    attributeValues: Record<string, string>
  }>
}

type Props = {
  rows: GroupListingRow[]
  selected: Set<string>
  onSelectedChange: (next: Set<string>) => void
  onRowChange: (
    id: string,
    patch: {
      retailPrice?: number | null
      channelAllocation?: number | null
      status?: 'ACTIVE' | 'SUSPENDED'
    }
  ) => void
  onDeleteRequest?: (id: string) => void
  deleteDisabledReason?: string
  dirtyIds?: Set<string>
  disabled?: boolean
}

type SortKey = 'name' | 'stock' | 'baseline' | 'retail' | 'status'
type SortDir = 'asc' | 'desc'
type SortState = { key: SortKey; dir: SortDir } | null

function nextSort(prev: SortState, key: SortKey): SortState {
  if (!prev || prev.key !== key) return { key, dir: 'asc' }
  if (prev.dir === 'asc') return { key, dir: 'desc' }
  return null
}

function compareNullableNumber(a: number | null, b: number | null, dir: SortDir): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return dir === 'asc' ? a - b : b - a
}

function compareString(a: string, b: string, dir: SortDir): number {
  const r = a.localeCompare(b, 'ko')
  return dir === 'asc' ? r : -r
}

const STATUS_ORDER: Record<'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED', number> = {
  ACTIVE: 0,
  SOLD_OUT: 1,
  SUSPENDED: 2,
}

export function GroupListingsTable({
  rows,
  selected,
  onSelectedChange,
  onRowChange,
  onDeleteRequest,
  deleteDisabledReason,
  dirtyIds,
  disabled,
}: Props) {
  const [sort, setSort] = useState<SortState>(null)
  const lastClickedIndex = useRef<number | null>(null)
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const someSelected = rows.some((r) => selected.has(r.id)) && !allSelected

  const displayRows = useMemo(() => {
    if (!sort) return rows
    const dir = sort.dir
    const arr = [...rows]
    arr.sort((a, b) => {
      switch (sort.key) {
        case 'name': {
          const aN = a.managementName?.trim() || a.searchName
          const bN = b.managementName?.trim() || b.searchName
          return compareString(aN, bN, dir)
        }
        case 'stock':
          return compareNullableNumber(a.availableStock, b.availableStock, dir)
        case 'baseline':
          return compareNullableNumber(a.baselinePrice, b.baselinePrice, dir)
        case 'retail':
          return compareNullableNumber(a.retailPrice, b.retailPrice, dir)
        case 'status': {
          const aV = STATUS_ORDER[a.effectiveStatus]
          const bV = STATUS_ORDER[b.effectiveStatus]
          return dir === 'asc' ? aV - bV : bV - aV
        }
      }
    })
    return arr
  }, [rows, sort])

  function toggleSort(key: SortKey) {
    setSort((prev) => nextSort(prev, key))
  }

  function toggleAll(checked: boolean) {
    onSelectedChange(checked ? new Set(rows.map((r) => r.id)) : new Set())
    lastClickedIndex.current = null
  }

  function toggleOne(id: string, index: number, shiftKey: boolean) {
    const allIds = rows.map((r) => r.id)
    const next = new Set(selected)
    if (shiftKey && lastClickedIndex.current !== null) {
      const from = Math.min(lastClickedIndex.current, index)
      const to = Math.max(lastClickedIndex.current, index)
      const adding = !selected.has(id)
      allIds.slice(from, to + 1).forEach((k) => (adding ? next.add(k) : next.delete(k)))
    } else {
      next.has(id) ? next.delete(id) : next.add(id)
    }
    lastClickedIndex.current = index
    onSelectedChange(next)
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
        이 상품의 판매채널 상품이 아직 없습니다
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected || (someSelected ? 'indeterminate' : false)}
                onCheckedChange={(v) => toggleAll(v === true)}
                aria-label="전체 선택"
                disabled={disabled}
              />
            </TableHead>
            <TableHead>
              <SortableHeaderButton label="구성" sortKey="name" sort={sort} onToggle={toggleSort} />
            </TableHead>
            <TableHead className="text-right">
              <SortableHeaderButton
                label="재고"
                sortKey="stock"
                sort={sort}
                onToggle={toggleSort}
                align="right"
              />
            </TableHead>
            <TableHead className="text-right">
              <SortableHeaderButton
                label="소비자가"
                sortKey="baseline"
                sort={sort}
                onToggle={toggleSort}
                align="right"
              />
            </TableHead>
            <TableHead className="w-36 text-right">
              <SortableHeaderButton
                label="판매가"
                sortKey="retail"
                sort={sort}
                onToggle={toggleSort}
                align="right"
              />
            </TableHead>
            <TableHead className="text-right">할인</TableHead>
            <TableHead className="w-32">
              <SortableHeaderButton
                label="판매상태"
                sortKey="status"
                sort={sort}
                onToggle={toggleSort}
              />
            </TableHead>
            {onDeleteRequest && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayRows.map((r, ri) => {
            const retailValue = r.retailPrice != null ? String(r.retailPrice) : ''
            const discount = computeDiscount(r.baselinePrice, r.retailPrice)
            const statusBadge =
              r.effectiveStatus === 'SUSPENDED' ? (
                <Badge variant="outline">판매중지</Badge>
              ) : r.effectiveStatus === 'SOLD_OUT' ? (
                <Badge variant="secondary">품절</Badge>
              ) : null
            const compositionLine = r.items
              .map((it) => `${it.optionName} ×${it.quantity}`)
              .join(' · ')
            const isSelected = selected.has(r.id)
            const isDirty = dirtyIds?.has(r.id) ?? false
            return (
              <TableRow
                key={r.id}
                className={isSelected ? 'bg-primary/5' : isDirty ? 'bg-amber-500/5' : undefined}
              >
                <TableCell>
                  <Checkbox
                    checked={isSelected}
                    onClick={(e: React.MouseEvent) => toggleOne(r.id, ri, e.shiftKey)}
                    onCheckedChange={() => {}}
                    aria-label={`${r.searchName} 선택`}
                    disabled={disabled}
                  />
                </TableCell>
                <TableCell>
                  <p className="text-sm font-medium">{r.managementName?.trim() || r.searchName}</p>
                  {r.managementName?.trim() && r.managementName.trim() !== r.searchName && (
                    <p className="text-xs text-muted-foreground">검색명: {r.searchName}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{compositionLine}</p>
                  {r.internalCode && (
                    <p className="text-xs text-muted-foreground">{r.internalCode}</p>
                  )}
                </TableCell>
                <TableCell
                  className={`text-right ${r.availableStock === 0 ? 'text-destructive' : ''}`}
                >
                  {r.availableStock.toLocaleString('ko-KR')}
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {r.baselinePrice != null ? `${r.baselinePrice.toLocaleString('ko-KR')}원` : '-'}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    min={0}
                    value={retailValue}
                    onChange={(e) => {
                      const v = e.target.value
                      onRowChange(r.id, {
                        retailPrice: v === '' ? null : Number(v),
                      })
                    }}
                    placeholder="-"
                    className="h-8 bg-background text-right"
                    disabled={disabled}
                  />
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {discount.percent != null ? `${discount.percent.toFixed(1)}%` : '-'}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={r.status}
                      onValueChange={(v) =>
                        onRowChange(r.id, { status: v as 'ACTIVE' | 'SUSPENDED' })
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8 w-28 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">판매중</SelectItem>
                        <SelectItem value="SUSPENDED">판매중지</SelectItem>
                      </SelectContent>
                    </Select>
                    {statusBadge}
                  </div>
                </TableCell>
                {onDeleteRequest && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onDeleteRequest(r.id)}
                      disabled={disabled || !!deleteDisabledReason}
                      title={deleteDisabledReason ?? '삭제'}
                      aria-label={`${r.searchName} 삭제`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function SortableHeaderButton({
  label,
  sortKey,
  sort,
  onToggle,
  align,
}: {
  label: string
  sortKey: SortKey
  sort: SortState
  onToggle: (k: SortKey) => void
  align?: 'right'
}) {
  const active = sort?.key === sortKey
  const dir = active ? sort!.dir : null
  const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className={`inline-flex items-center gap-1 hover:text-foreground ${
        active ? 'text-foreground' : 'text-muted-foreground'
      } ${align === 'right' ? 'ml-auto' : ''}`}
    >
      <span>{label}</span>
      <Icon className={`h-3 w-3 ${active ? '' : 'opacity-50'}`} />
    </button>
  )
}
