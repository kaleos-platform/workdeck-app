'use client'

import { useMemo, useRef, useState } from 'react'
import { applyRangeSelection } from '@/lib/range-selection'
import { ArrowDown, ArrowUp, ArrowUpDown, Trash2 } from 'lucide-react'

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
import { computeDiscount, computeListingRetailBaseline } from '@/lib/sh/listing-calc'

import type { ItemEntry } from './composition-builder'
import { GroupBulkEditBar, type BulkPatch } from './group-bulk-edit-bar'

/**
 * 새 판매채널 상품 생성 화면에서 CompositionBuilder가 만들어낸 group들을
 * "편집 가능한 테이블"로 표시한다. 그룹 상세(GroupListingsTable)의 UI와 동일한 톤을 유지하되,
 * 서버에 아직 저장되지 않은 draft 상태이므로 row별 inline Input이 바로 로컬 state에 반영된다.
 */

export type CompositionRow = {
  key: string
  suffixParts: string[]
  items: ItemEntry[]
  retailPrice: string
  channelStock: string
  status: 'ACTIVE' | 'SUSPENDED'
  /** manual 모드에서만 설정. BuiltGroup.manualNames에서 복사. */
  manualNames?: {
    searchName?: string
    displayName?: string
    managementName?: string
    internalCode?: string
  }
}

type Props = {
  rows: CompositionRow[]
  baseSearchName: string
  onRowsChange: (next: CompositionRow[]) => void
  selected: Set<string>
  onSelectedChange: (next: Set<string>) => void
  disabled?: boolean
}

type SortKey = 'name' | 'composition' | 'stock' | 'baseline' | 'retail' | 'status'
type SortDir = 'asc' | 'desc'
type SortState = { key: SortKey; dir: SortDir } | null

function nextSort(prev: SortState, key: SortKey): SortState {
  if (!prev || prev.key !== key) return { key, dir: 'asc' }
  if (prev.dir === 'asc') return { key, dir: 'desc' }
  return null
}

function compareNullableNumber(a: number | null, b: number | null, dir: SortDir): number {
  if (a == null && b == null) return 0
  if (a == null) return 1 // null은 항상 끝
  if (b == null) return -1
  return dir === 'asc' ? a - b : b - a
}

function compareString(a: string, b: string, dir: SortDir): number {
  const r = a.localeCompare(b, 'ko')
  return dir === 'asc' ? r : -r
}

export function CompositionRowsTable({
  rows,
  baseSearchName,
  onRowsChange,
  selected,
  onSelectedChange,
  disabled,
}: Props) {
  const [sort, setSort] = useState<SortState>(null)
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.key))
  const someSelected = rows.some((r) => selected.has(r.key)) && !allSelected

  const displayRows = useMemo(() => {
    if (!sort) return rows
    const dir = sort.dir
    const arr = [...rows]
    arr.sort((a, b) => {
      switch (sort.key) {
        case 'name': {
          const aN =
            a.manualNames?.searchName ??
            [baseSearchName, ...a.suffixParts].filter(Boolean).join(' ')
          const bN =
            b.manualNames?.searchName ??
            [baseSearchName, ...b.suffixParts].filter(Boolean).join(' ')
          return compareString(aN, bN, dir)
        }
        case 'composition': {
          const aC = a.items.map((it) => `${it.optionName} ×${it.quantity}`).join(' · ')
          const bC = b.items.map((it) => `${it.optionName} ×${it.quantity}`).join(' · ')
          return compareString(aC, bC, dir)
        }
        case 'stock': {
          const aS = a.channelStock.trim() === '' ? null : Number(a.channelStock)
          const bS = b.channelStock.trim() === '' ? null : Number(b.channelStock)
          return compareNullableNumber(aS, bS, dir)
        }
        case 'baseline': {
          const aB = computeListingRetailBaseline(
            a.items.map((it) => ({ quantity: it.quantity, retailPrice: it.retailPrice }))
          )
          const bB = computeListingRetailBaseline(
            b.items.map((it) => ({ quantity: it.quantity, retailPrice: it.retailPrice }))
          )
          return compareNullableNumber(aB, bB, dir)
        }
        case 'retail': {
          const aR = a.retailPrice.trim() === '' ? null : Number(a.retailPrice)
          const bR = b.retailPrice.trim() === '' ? null : Number(b.retailPrice)
          return compareNullableNumber(aR, bR, dir)
        }
        case 'status': {
          const order = (s: 'ACTIVE' | 'SUSPENDED') => (s === 'ACTIVE' ? 0 : 1)
          const aV = order(a.status)
          const bV = order(b.status)
          return dir === 'asc' ? aV - bV : bV - aV
        }
      }
    })
    return arr
  }, [rows, sort, baseSearchName])

  function toggleSort(key: SortKey) {
    setSort((prev) => nextSort(prev, key))
  }

  function toggleAll(v: boolean) {
    onSelectedChange(v ? new Set(rows.map((r) => r.key)) : new Set())
  }

  const lastClickedIndexRef = useRef<number | null>(null)
  function toggleOne(key: string, allKeys: string[], index: number, shiftKey: boolean) {
    const next = applyRangeSelection(
      selected,
      allKeys,
      key,
      index,
      shiftKey,
      lastClickedIndexRef.current
    )
    lastClickedIndexRef.current = index
    onSelectedChange(next)
  }

  function updateRow(key: string, patch: Partial<CompositionRow>) {
    onRowsChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function removeRow(key: string) {
    onRowsChange(rows.filter((r) => r.key !== key))
    const next = new Set(selected)
    next.delete(key)
    onSelectedChange(next)
  }

  function applyBulk(patch: BulkPatch) {
    if (selected.size === 0) return
    onRowsChange(
      rows.map((r) => {
        if (!selected.has(r.key)) return r
        const next = { ...r }
        if (patch.retailPrice !== undefined) {
          next.retailPrice = patch.retailPrice == null ? '' : String(patch.retailPrice)
        }
        if (patch.channelStock !== undefined) {
          next.channelStock = patch.channelStock == null ? '' : String(patch.channelStock)
        }
        if (patch.status !== undefined) next.status = patch.status
        return next
      })
    )
  }

  function deleteSelected() {
    if (selected.size === 0) return
    onRowsChange(rows.filter((r) => !selected.has(r.key)))
    onSelectedChange(new Set())
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
        아직 구성된 옵션이 없습니다. 위의 &lsquo;구성 만들기&rsquo; 버튼으로 추가하세요
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <GroupBulkEditBar
          selectedCount={selected.size}
          onClear={() => onSelectedChange(new Set())}
          onApply={async (patch) => applyBulk(patch)}
          onRequestDelete={deleteSelected}
        />
      )}
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
                <SortableHeaderButton
                  label="검색명 (생성 예정)"
                  sortKey="name"
                  sort={sort}
                  onToggle={toggleSort}
                />
              </TableHead>
              <TableHead>
                <SortableHeaderButton
                  label="구성 옵션"
                  sortKey="composition"
                  sort={sort}
                  onToggle={toggleSort}
                />
              </TableHead>
              <TableHead className="w-28 text-right">
                <SortableHeaderButton
                  label="채널 재고"
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
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayRows.map((r, idx) => {
              const baseline = computeListingRetailBaseline(
                r.items.map((it) => ({ quantity: it.quantity, retailPrice: it.retailPrice }))
              )
              const salePrice = r.retailPrice.trim() === '' ? null : Number(r.retailPrice)
              const discount = computeDiscount(baseline, salePrice)
              // manual 모드: manualNames.searchName 우선, 없으면 base+suffix 조합
              const previewName = r.manualNames?.searchName
                ? r.manualNames.searchName
                : [baseSearchName, ...r.suffixParts].filter(Boolean).join(' ')
              const composition = r.items
                .map((it) => `${it.optionName} ×${it.quantity}`)
                .join(' · ')
              return (
                <TableRow key={r.key} className={selected.has(r.key) ? 'bg-primary/5' : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(r.key)}
                      onClick={(e: React.MouseEvent) =>
                        toggleOne(
                          r.key,
                          displayRows.map((d) => d.key),
                          idx,
                          e.shiftKey
                        )
                      }
                      onCheckedChange={() => {}}
                      aria-label={`${previewName} 선택`}
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium">{previewName || '(검색명 미지정)'}</p>
                    {r.suffixParts.length > 0 && (
                      <p className="text-xs text-muted-foreground">{r.suffixParts.join(' / ')}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{composition}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={0}
                      value={r.channelStock}
                      onChange={(e) => updateRow(r.key, { channelStock: e.target.value })}
                      placeholder="미사용"
                      className="h-8 bg-background text-right"
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {baseline != null ? `${baseline.toLocaleString('ko-KR')}원` : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={0}
                      value={r.retailPrice}
                      onChange={(e) => updateRow(r.key, { retailPrice: e.target.value })}
                      placeholder="-"
                      className="h-8 bg-background text-right"
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {discount.percent != null ? `${discount.percent.toFixed(1)}%` : '-'}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={r.status}
                      onValueChange={(v) =>
                        updateRow(r.key, { status: v as 'ACTIVE' | 'SUSPENDED' })
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
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => removeRow(r.key)}
                      disabled={disabled}
                      aria-label="제거"
                      title="제거"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
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
