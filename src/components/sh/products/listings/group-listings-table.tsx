'use client'

import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'

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

export type GroupListingRow = {
  id: string
  searchName: string
  displayName: string
  internalCode: string | null
  status: 'ACTIVE' | 'SUSPENDED'
  effectiveStatus: 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'
  retailPrice: number | null
  baselinePrice: number | null
  discountAmount: number | null
  discountPercent: number | null
  availableStock: number
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
  onRowSave: (
    id: string,
    patch: { retailPrice?: number | null; status?: 'ACTIVE' | 'SUSPENDED' }
  ) => Promise<void>
  savingRowId: string | null
}

export function GroupListingsTable({
  rows,
  selected,
  onSelectedChange,
  onRowSave,
  savingRowId,
}: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const someSelected = rows.some((r) => selected.has(r.id)) && !allSelected

  function toggleAll(checked: boolean) {
    if (checked) {
      onSelectedChange(new Set(rows.map((r) => r.id)))
    } else {
      onSelectedChange(new Set())
    }
  }

  function toggleOne(id: string, checked: boolean) {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
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
              />
            </TableHead>
            <TableHead>구성</TableHead>
            <TableHead className="text-right">재고</TableHead>
            <TableHead className="text-right">소비자가</TableHead>
            <TableHead className="w-36 text-right">판매가</TableHead>
            <TableHead className="text-right">할인</TableHead>
            <TableHead className="w-32">판매상태</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <GroupListingRowView
              key={r.id}
              row={r}
              selected={selected.has(r.id)}
              onToggle={(v) => toggleOne(r.id, v)}
              onSave={onRowSave}
              saving={savingRowId === r.id}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function GroupListingRowView({
  row,
  selected,
  onToggle,
  onSave,
  saving,
}: {
  row: GroupListingRow
  selected: boolean
  onToggle: (v: boolean) => void
  onSave: (
    id: string,
    patch: { retailPrice?: number | null; status?: 'ACTIVE' | 'SUSPENDED' }
  ) => Promise<void>
  saving: boolean
}) {
  const [retailDraft, setRetailDraft] = useState(
    row.retailPrice != null ? String(row.retailPrice) : ''
  )
  const [statusDraft, setStatusDraft] = useState<'ACTIVE' | 'SUSPENDED'>(row.status)

  const retailDirty = (retailDraft === '' ? null : Number(retailDraft)) !== row.retailPrice
  const statusDirty = statusDraft !== row.status
  const dirty = retailDirty || statusDirty

  async function save() {
    const patch: { retailPrice?: number | null; status?: 'ACTIVE' | 'SUSPENDED' } = {}
    if (retailDirty) patch.retailPrice = retailDraft === '' ? null : Number(retailDraft)
    if (statusDirty) patch.status = statusDraft
    await onSave(row.id, patch)
  }

  function reset() {
    setRetailDraft(row.retailPrice != null ? String(row.retailPrice) : '')
    setStatusDraft(row.status)
  }

  const statusBadge =
    row.effectiveStatus === 'SUSPENDED' ? (
      <Badge variant="outline">판매중지</Badge>
    ) : row.effectiveStatus === 'SOLD_OUT' ? (
      <Badge variant="secondary">품절</Badge>
    ) : null

  const compositionLine = row.items.map((it) => `${it.optionName} ×${it.quantity}`).join(' · ')

  return (
    <TableRow className={selected ? 'bg-primary/5' : undefined}>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onToggle(v === true)}
          aria-label={`${row.searchName} 선택`}
        />
      </TableCell>
      <TableCell>
        <p className="text-sm font-medium">{row.searchName}</p>
        <p className="text-xs text-muted-foreground">{compositionLine}</p>
        {row.internalCode && <p className="text-xs text-muted-foreground">{row.internalCode}</p>}
      </TableCell>
      <TableCell className={`text-right ${row.availableStock === 0 ? 'text-destructive' : ''}`}>
        {row.availableStock.toLocaleString('ko-KR')}
      </TableCell>
      <TableCell className="text-right text-sm text-muted-foreground">
        {row.baselinePrice != null ? `${row.baselinePrice.toLocaleString('ko-KR')}원` : '-'}
      </TableCell>
      <TableCell className="text-right">
        <Input
          type="number"
          min={0}
          value={retailDraft}
          onChange={(e) => setRetailDraft(e.target.value)}
          placeholder="-"
          className="h-8 text-right"
        />
      </TableCell>
      <TableCell className="text-right text-sm text-muted-foreground">
        {row.discountPercent != null ? `${row.discountPercent.toFixed(1)}%` : '-'}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Select
            value={statusDraft}
            onValueChange={(v) => setStatusDraft(v as 'ACTIVE' | 'SUSPENDED')}
          >
            <SelectTrigger className="h-8 w-28">
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
      <TableCell className="text-right">
        {dirty && (
          <div className="flex items-center justify-end gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={reset}
              disabled={saving}
              aria-label="되돌리기"
              title="되돌리기"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              className="h-8 w-8"
              onClick={save}
              disabled={saving}
              aria-label="저장"
              title="저장"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  )
}
