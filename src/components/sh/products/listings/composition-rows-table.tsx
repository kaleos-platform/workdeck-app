'use client'

import { Trash2 } from 'lucide-react'

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
import { computeListingRetailBaseline } from '@/lib/sh/listing-calc'

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
  status: 'ACTIVE' | 'SUSPENDED'
}

type Props = {
  rows: CompositionRow[]
  baseSearchName: string
  onRowsChange: (next: CompositionRow[]) => void
  selected: Set<string>
  onSelectedChange: (next: Set<string>) => void
  disabled?: boolean
}

export function CompositionRowsTable({
  rows,
  baseSearchName,
  onRowsChange,
  selected,
  onSelectedChange,
  disabled,
}: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.key))
  const someSelected = rows.some((r) => selected.has(r.key)) && !allSelected

  function toggleAll(v: boolean) {
    onSelectedChange(v ? new Set(rows.map((r) => r.key)) : new Set())
  }

  function toggleOne(key: string, v: boolean) {
    const next = new Set(selected)
    if (v) next.add(key)
    else next.delete(key)
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
        if (patch.status !== undefined) next.status = patch.status
        return next
      })
    )
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
              <TableHead>검색명 (생성 예정)</TableHead>
              <TableHead>구성 옵션</TableHead>
              <TableHead className="text-right">소비자가</TableHead>
              <TableHead className="w-36 text-right">판매가</TableHead>
              <TableHead className="w-32">판매상태</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const baseline = computeListingRetailBaseline(
                r.items.map((it) => ({ quantity: it.quantity, retailPrice: it.retailPrice }))
              )
              const previewName = [baseSearchName, ...r.suffixParts].filter(Boolean).join(' ')
              const composition = r.items
                .map((it) => `${it.optionName} ×${it.quantity}`)
                .join(' · ')
              return (
                <TableRow key={r.key} className={selected.has(r.key) ? 'bg-primary/5' : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(r.key)}
                      onCheckedChange={(v) => toggleOne(r.key, v === true)}
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
                      className="h-8 text-right"
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={r.status}
                      onValueChange={(v) =>
                        updateRow(r.key, { status: v as 'ACTIVE' | 'SUSPENDED' })
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8 w-28">
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
