'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { OrderProductFields, type OrderProduct } from '@/components/del/order-product-fields'

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

export function RegistrationTable({
  rows,
  onChange,
  shippingMethods,
  channels,
}: RegistrationTableProps) {
  function addRow() {
    onChange([...rows, createEmptyRow()])
  }

  function removeRow(tempId: string) {
    onChange(rows.filter((r) => r.tempId !== tempId))
  }

  function updateRow(tempId: string, field: keyof OrderRow, value: unknown) {
    onChange(
      rows.map((r) => (r.tempId === tempId ? { ...r, [field]: value } : r))
    )
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead className="min-w-[120px]">배송방식</TableHead>
              <TableHead className="min-w-[80px]">받는분</TableHead>
              <TableHead className="min-w-[120px]">전화</TableHead>
              <TableHead className="min-w-[200px]">주소</TableHead>
              <TableHead className="min-w-[100px]">배송메시지</TableHead>
              <TableHead className="min-w-[120px]">주문일자</TableHead>
              <TableHead className="min-w-[120px]">판매채널</TableHead>
              <TableHead className="min-w-[100px]">주문번호</TableHead>
              <TableHead className="min-w-[100px]">결제금액</TableHead>
              <TableHead className="min-w-[180px]">상품</TableHead>
              <TableHead className="min-w-[120px]">메모</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                  주문을 추가해 주세요
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, idx) => (
                <TableRow key={row.tempId}>
                  <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell>
                    <Select
                      value={row.shippingMethodId || NO_VALUE}
                      onValueChange={(v) =>
                        updateRow(row.tempId, 'shippingMethodId', v === NO_VALUE ? '' : v)
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_VALUE}>선택</SelectItem>
                        {shippingMethods.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-xs"
                      value={row.recipientName}
                      onChange={(e) => updateRow(row.tempId, 'recipientName', e.target.value)}
                      placeholder="이름"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-xs"
                      value={row.phone}
                      onChange={(e) => updateRow(row.tempId, 'phone', e.target.value)}
                      placeholder="010-0000-0000"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-xs"
                      value={row.address}
                      onChange={(e) => updateRow(row.tempId, 'address', e.target.value)}
                      placeholder="주소"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-xs"
                      value={row.deliveryMessage}
                      onChange={(e) => updateRow(row.tempId, 'deliveryMessage', e.target.value)}
                      placeholder="메시지"
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
                    <Select
                      value={row.channelId || NO_VALUE}
                      onValueChange={(v) =>
                        updateRow(row.tempId, 'channelId', v === NO_VALUE ? '' : v)
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_VALUE}>선택</SelectItem>
                        {channels.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-xs"
                      value={row.orderNumber}
                      onChange={(e) => updateRow(row.tempId, 'orderNumber', e.target.value)}
                      placeholder="주문번호"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-xs"
                      type="number"
                      value={row.paymentAmount}
                      onChange={(e) => updateRow(row.tempId, 'paymentAmount', e.target.value)}
                      placeholder="금액"
                    />
                  </TableCell>
                  <TableCell>
                    <OrderProductFields
                      value={row.items}
                      onChange={(items) => updateRow(row.tempId, 'items', items)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-xs"
                      value={row.memo}
                      onChange={(e) => updateRow(row.tempId, 'memo', e.target.value)}
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
              ))
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
