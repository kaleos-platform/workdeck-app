'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  OrderProductFields,
  type OrderProduct,
} from '@/components/sh/shipping/order-product-fields'
import { cn } from '@/lib/utils'

export type OrderRow = {
  tempId: string
  shippingMethodId: string
  recipientName: string
  phone: string
  address: string
  postalCode: string
  deliveryMessage: string
  orderDate: string
  channelId: string
  orderNumber: string
  paymentAmount: string
  items: OrderProduct[]
  memo: string
}

type ShippingMethod = { id: string; name: string }
type Channel = {
  id: string
  name: string
  requireOrderNumber: boolean
  requirePayment: boolean
  requireProducts: boolean
}

type RegistrationTableProps = {
  rows: OrderRow[]
  onChange: (rows: OrderRow[]) => void
  shippingMethods: ShippingMethod[]
  channels: Channel[]
  onRemove?: (tempId: string) => void | Promise<void>
  selectedIds?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
}

let tempCounter = 0
export function createEmptyRow(): OrderRow {
  return {
    tempId: `temp-${++tempCounter}`,
    shippingMethodId: '',
    recipientName: '',
    phone: '',
    address: '',
    postalCode: '',
    deliveryMessage: '',
    orderDate: new Date().toISOString().split('T')[0],
    channelId: '',
    orderNumber: '',
    paymentAmount: '',
    items: [],
    memo: '',
  }
}

const NO_VALUE = '__none__'
// 필수 필드 미입력 시 시각적 표시 (빨간 링)
const REQUIRED_INVALID = 'ring-2 ring-destructive/50 border-destructive/50'
// 입력값 앞쪽 공백 제거
const trimStart = (v: string) => v.replace(/^\s+/, '')
// 셀 공용 텍스트 입력(가로 초과 시 최대 2줄로 감싸짐) 스타일
const CELL_TEXTAREA =
  'field-sizing-content min-h-8 max-h-12 text-xs leading-tight px-2 py-1 resize-none md:text-xs shadow-none'

export function RegistrationTable({
  rows,
  onChange,
  shippingMethods,
  channels,
  onRemove,
  selectedIds,
  onSelectionChange,
}: RegistrationTableProps) {
  const selectionEnabled = !!selectedIds && !!onSelectionChange

  function addRow() {
    onChange([...rows, createEmptyRow()])
  }

  function removeRow(tempId: string) {
    if (onRemove) {
      onRemove(tempId)
    } else {
      onChange(rows.filter((r) => r.tempId !== tempId))
    }
  }

  function toggleRow(tempId: string, checked: boolean) {
    if (!onSelectionChange || !selectedIds) return
    const next = new Set(selectedIds)
    if (checked) next.add(tempId)
    else next.delete(tempId)
    onSelectionChange(next)
  }

  function toggleAll(checked: boolean) {
    if (!onSelectionChange) return
    if (checked) onSelectionChange(new Set(rows.map((r) => r.tempId)))
    else onSelectionChange(new Set())
  }

  const allSelected = selectionEnabled && rows.length > 0 && selectedIds.size === rows.length
  const someSelected = selectionEnabled && selectedIds.size > 0 && selectedIds.size < rows.length

  function updateRow(tempId: string, field: keyof OrderRow, value: unknown) {
    onChange(rows.map((r) => (r.tempId === tempId ? { ...r, [field]: value } : r)))
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {selectionEnabled && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={(v) => toggleAll(v === true)}
                    aria-label="전체 선택"
                  />
                </TableHead>
              )}
              <TableHead className="min-w-[100px]">
                배송방식<span className="ml-0.5 text-destructive">*</span>
              </TableHead>
              <TableHead className="min-w-[100px]">
                판매채널<span className="ml-0.5 text-destructive">*</span>
              </TableHead>
              <TableHead className="min-w-[90px]">받는분</TableHead>
              <TableHead className="min-w-[120px]">전화</TableHead>
              <TableHead className="min-w-[220px]">주소</TableHead>
              <TableHead className="min-w-[130px]">배송메시지</TableHead>
              <TableHead className="min-w-[220px]">상품</TableHead>
              <TableHead className="min-w-[120px]">주문일자</TableHead>
              <TableHead className="min-w-[100px]">주문번호</TableHead>
              <TableHead className="min-w-[100px]">결제금액</TableHead>
              <TableHead className="min-w-[100px]">메모</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={selectionEnabled ? 13 : 12}
                  className="py-8 text-center text-muted-foreground"
                >
                  주문을 추가해 주세요
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const channel = channels.find((c) => c.id === row.channelId)
                const requireOrderNumber = channel?.requireOrderNumber ?? false
                const requirePayment = channel?.requirePayment ?? false
                const requireProducts = channel?.requireProducts ?? false

                const missingShipping = !row.shippingMethodId
                const missingChannel = !row.channelId
                const missingOrderNumber = requireOrderNumber && !row.orderNumber
                const missingPayment = requirePayment && !row.paymentAmount
                const missingProducts =
                  requireProducts && row.items.filter((i) => i.name).length === 0

                return (
                  <TableRow
                    key={row.tempId}
                    className={cn(
                      '[&>td]:align-top',
                      selectionEnabled && selectedIds?.has(row.tempId) && 'bg-primary/5'
                    )}
                  >
                    {selectionEnabled && (
                      <TableCell>
                        <Checkbox
                          checked={selectedIds?.has(row.tempId) ?? false}
                          onCheckedChange={(v) => toggleRow(row.tempId, v === true)}
                          aria-label="행 선택"
                          className="mt-1.5"
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Select
                        value={row.shippingMethodId || NO_VALUE}
                        onValueChange={(v) =>
                          updateRow(row.tempId, 'shippingMethodId', v === NO_VALUE ? '' : v)
                        }
                      >
                        <SelectTrigger
                          className={cn('h-8 text-xs', missingShipping && REQUIRED_INVALID)}
                        >
                          <SelectValue placeholder="선택 *" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_VALUE}>선택</SelectItem>
                          {shippingMethods.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={row.channelId || NO_VALUE}
                        onValueChange={(v) =>
                          updateRow(row.tempId, 'channelId', v === NO_VALUE ? '' : v)
                        }
                      >
                        <SelectTrigger
                          className={cn('h-8 text-xs', missingChannel && REQUIRED_INVALID)}
                        >
                          <SelectValue placeholder="선택 *" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_VALUE}>선택</SelectItem>
                          {channels.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Textarea
                        rows={1}
                        className={CELL_TEXTAREA}
                        value={row.recipientName}
                        onChange={(e) =>
                          updateRow(row.tempId, 'recipientName', trimStart(e.target.value))
                        }
                        placeholder="이름"
                      />
                    </TableCell>
                    <TableCell>
                      <Textarea
                        rows={1}
                        className={CELL_TEXTAREA}
                        value={row.phone}
                        onChange={(e) => updateRow(row.tempId, 'phone', trimStart(e.target.value))}
                        placeholder="010-0000-0000"
                      />
                    </TableCell>
                    <TableCell>
                      <Textarea
                        rows={1}
                        className={CELL_TEXTAREA}
                        value={row.address}
                        onChange={(e) =>
                          updateRow(row.tempId, 'address', trimStart(e.target.value))
                        }
                        placeholder="주소"
                      />
                    </TableCell>
                    <TableCell>
                      <Textarea
                        rows={1}
                        className={CELL_TEXTAREA}
                        value={row.deliveryMessage}
                        onChange={(e) =>
                          updateRow(row.tempId, 'deliveryMessage', trimStart(e.target.value))
                        }
                        placeholder="메시지"
                      />
                    </TableCell>
                    <TableCell>
                      <OrderProductFields
                        value={row.items}
                        onChange={(items) => updateRow(row.tempId, 'items', items)}
                        invalid={missingProducts}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 text-xs"
                        type="date"
                        value={row.orderDate}
                        onChange={(e) => updateRow(row.tempId, 'orderDate', e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Textarea
                        rows={1}
                        className={cn(CELL_TEXTAREA, missingOrderNumber && REQUIRED_INVALID)}
                        value={row.orderNumber}
                        onChange={(e) =>
                          updateRow(row.tempId, 'orderNumber', trimStart(e.target.value))
                        }
                        placeholder={requireOrderNumber ? '주문번호 *' : '주문번호'}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className={cn('h-8 text-right text-xs', missingPayment && REQUIRED_INVALID)}
                        type="text"
                        inputMode="numeric"
                        value={
                          row.paymentAmount ? Number(row.paymentAmount).toLocaleString('ko-KR') : ''
                        }
                        onChange={(e) => {
                          const digits = e.target.value.replace(/[^0-9]/g, '')
                          updateRow(row.tempId, 'paymentAmount', digits)
                        }}
                        placeholder={requirePayment ? '금액 *' : '금액'}
                      />
                    </TableCell>
                    <TableCell>
                      <Textarea
                        rows={1}
                        className={CELL_TEXTAREA}
                        value={row.memo}
                        onChange={(e) => updateRow(row.tempId, 'memo', trimStart(e.target.value))}
                        placeholder="메모"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeRow(row.tempId)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Button variant="outline" size="sm" onClick={addRow}>
        <Plus className="mr-1 h-4 w-4" />행 추가
      </Button>
    </div>
  )
}
