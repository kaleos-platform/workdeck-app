'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Channel = { id: string; name: string }
type ShippingMethod = { id: string; name: string }

// 비PII 초기값 — host가 보유한 주문 필드 그대로 전달. PII는 내부에서 decrypt로 로드.
export type OrderEditInitial = {
  postalCode: string | null
  deliveryMessage: string | null
  orderDate: string | null
  orderNumber: string | null
  paymentAmount: string | number | null
  memo: string | null
  shippingMethodId: string | null
  channelId: string | null
  items: { name: string; quantity: number }[]
}

type Props = {
  orderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: OrderEditInitial
  shippingMethods: ShippingMethod[]
  channels: Channel[]
  /** 저장 성공 후 호출. host가 decrypt 캐시 무효화 + refetch 책임. */
  onSaved: (orderId: string) => void
  /** 전달 시에만 삭제 버튼 노출. 삭제 성공 후 호출. */
  onDeleted?: (orderId: string) => void
}

const NO_VALUE = '__none__'

type EditForm = {
  recipientName: string
  phone: string
  address: string
  postalCode: string
  deliveryMessage: string
  orderDate: string
  orderNumber: string
  paymentAmount: string
  memo: string
  shippingMethodId: string
  channelId: string
  items: { name: string; quantity: number }[]
}

function buildInitialForm(initial: OrderEditInitial): EditForm {
  return {
    recipientName: '',
    phone: '',
    address: '',
    postalCode: initial.postalCode ?? '',
    deliveryMessage: initial.deliveryMessage ?? '',
    orderDate: initial.orderDate ? initial.orderDate.split('T')[0] : '',
    orderNumber: initial.orderNumber ?? '',
    paymentAmount: initial.paymentAmount != null ? String(initial.paymentAmount) : '',
    memo: initial.memo ?? '',
    shippingMethodId: initial.shippingMethodId ?? '',
    channelId: initial.channelId ?? '',
    items:
      initial.items.length > 0
        ? initial.items.map((i) => ({ name: i.name, quantity: i.quantity }))
        : [{ name: '', quantity: 1 }],
  }
}

/**
 * 주문 수정 다이얼로그 (공용).
 * 배송 데이터 상세 테이블 + 검색 결과 양쪽에서 사용.
 * PII는 열 때 POST /orders/[id]/decrypt로 로드, 저장은 PATCH /orders/[id].
 */
export function OrderEditDialog({
  orderId,
  open,
  onOpenChange,
  initial,
  shippingMethods,
  channels,
  onSaved,
  onDeleted,
}: Props) {
  const [form, setForm] = useState<EditForm>(() => buildInitialForm(initial))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // 열릴 때마다 폼 초기화 + PII 복호화 로드
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setForm(buildInitialForm(initial))
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/sh/shipping/orders/${orderId}/decrypt`, { method: 'POST' })
        if (!res.ok) throw new Error('복호화 실패')
        const pii: { recipientName: string; phone: string; address: string } = await res.json()
        if (cancelled) return
        setForm((f) => ({
          ...f,
          recipientName: pii.recipientName,
          phone: pii.phone,
          address: pii.address,
        }))
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : '복호화 실패')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // initial은 열 때 시점의 값만 사용 — open/orderId 변경시에만 재실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId])

  const addItem = () => {
    if (form.items.length >= 10) return
    setForm((f) => ({ ...f, items: [...f.items, { name: '', quantity: 1 }] }))
  }
  const removeItem = (idx: number) => {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))
  }
  const updateItem = (idx: number, field: 'name' | 'quantity', value: string | number) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, [field]: value } : it)),
    }))
  }

  const handleSave = async () => {
    if (!form.recipientName || !form.phone || !form.address) {
      toast.error('받는분, 전화, 주소는 필수입니다')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/sh/shipping/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientName: form.recipientName,
          phone: form.phone,
          address: form.address,
          postalCode: form.postalCode || null,
          deliveryMessage: form.deliveryMessage || null,
          orderDate: form.orderDate,
          orderNumber: form.orderNumber || null,
          paymentAmount: form.paymentAmount ? Number(form.paymentAmount) : null,
          memo: form.memo || null,
          shippingMethodId: form.shippingMethodId || undefined,
          channelId: form.channelId || null,
          items: form.items.filter((i) => i.name),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '수정 실패')
      }
      toast.success('주문이 수정되었습니다')
      onOpenChange(false)
      onSaved(orderId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '수정 실패')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!onDeleted) return
    if (!confirm('이 주문을 삭제하시겠습니까?')) return
    try {
      const res = await fetch(`/api/sh/shipping/orders/${orderId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '삭제 실패')
      }
      toast.success('주문이 삭제되었습니다')
      onOpenChange(false)
      onDeleted(orderId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>주문 수정</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">복호화 중...</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">받는분 *</Label>
                <Input
                  className="h-8 text-sm"
                  value={form.recipientName}
                  onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">전화 *</Label>
                <Input
                  className="h-8 text-sm"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">주소 *</Label>
              <Input
                className="h-8 text-sm"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">우편번호</Label>
                <Input
                  className="h-8 text-sm"
                  value={form.postalCode}
                  onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">주문일자</Label>
                <Input
                  className="h-8 text-sm"
                  type="date"
                  value={form.orderDate}
                  onChange={(e) => setForm((f) => ({ ...f, orderDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">배송메시지</Label>
              <Input
                className="h-8 text-sm"
                value={form.deliveryMessage}
                onChange={(e) => setForm((f) => ({ ...f, deliveryMessage: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">주문번호</Label>
                <Input
                  className="h-8 text-sm"
                  value={form.orderNumber}
                  onChange={(e) => setForm((f) => ({ ...f, orderNumber: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">결제금액</Label>
                <Input
                  className="h-8 text-sm"
                  type="number"
                  value={form.paymentAmount}
                  onChange={(e) => setForm((f) => ({ ...f, paymentAmount: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">배송방식</Label>
                <Select
                  value={form.shippingMethodId || NO_VALUE}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, shippingMethodId: v === NO_VALUE ? '' : v }))
                  }
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="선택" />
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
              </div>
              <div className="space-y-1">
                <Label className="text-xs">판매채널</Label>
                <Select
                  value={form.channelId || NO_VALUE}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, channelId: v === NO_VALUE ? '' : v }))
                  }
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_VALUE}>없음</SelectItem>
                    {channels.map((ch) => (
                      <SelectItem key={ch.id} value={ch.id}>
                        {ch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">메모</Label>
              <Textarea
                className="h-16 text-sm"
                value={form.memo}
                onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">상품</Label>
              {form.items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    className="h-8 flex-1 text-sm"
                    placeholder="상품명"
                    value={item.name}
                    onChange={(e) => updateItem(idx, 'name', e.target.value)}
                  />
                  <Input
                    className="h-8 w-20 text-sm"
                    type="number"
                    min={1}
                    placeholder="수량"
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value) || 1)}
                  />
                  {form.items.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => removeItem(idx)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
              {form.items.length < 10 && (
                <Button variant="outline" size="sm" className="text-xs" onClick={addItem}>
                  + 상품 추가
                </Button>
              )}
            </div>
          </div>
        )}
        <DialogFooter className="flex justify-between sm:justify-between">
          {onDeleted ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={loading || saving}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              삭제
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button onClick={handleSave} disabled={loading || saving}>
              {saving ? '저장 중...' : '저장'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
