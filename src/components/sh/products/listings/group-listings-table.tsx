'use client'

import { Trash2 } from 'lucide-react'

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
  onRowChange: (
    id: string,
    patch: { retailPrice?: number | null; status?: 'ACTIVE' | 'SUSPENDED' }
  ) => void
  onDeleteRequest?: (id: string) => void
  deleteDisabledReason?: string
  dirtyIds?: Set<string>
  disabled?: boolean
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
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const someSelected = rows.some((r) => selected.has(r.id)) && !allSelected

  function toggleAll(checked: boolean) {
    onSelectedChange(checked ? new Set(rows.map((r) => r.id)) : new Set())
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
                disabled={disabled}
              />
            </TableHead>
            <TableHead>구성</TableHead>
            <TableHead className="text-right">재고</TableHead>
            <TableHead className="text-right">소비자가</TableHead>
            <TableHead className="w-36 text-right">판매가</TableHead>
            <TableHead className="text-right">할인</TableHead>
            <TableHead className="w-32">판매상태</TableHead>
            {onDeleteRequest && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const retailValue = r.retailPrice != null ? String(r.retailPrice) : ''
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
                    onCheckedChange={(v) => toggleOne(r.id, v === true)}
                    aria-label={`${r.searchName} 선택`}
                    disabled={disabled}
                  />
                </TableCell>
                <TableCell>
                  <p className="text-sm font-medium">{r.searchName}</p>
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
                    className="h-8 text-right"
                    disabled={disabled}
                  />
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {r.discountPercent != null ? `${r.discountPercent.toFixed(1)}%` : '-'}
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
