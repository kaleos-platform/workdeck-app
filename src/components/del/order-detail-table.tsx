'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, Pencil, Trash2 } from 'lucide-react'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { DeliveryFileDialog } from '@/components/del/delivery-file-dialog'

interface OrderItem {
  id: string
  name: string
  quantity: number
}

interface Channel {
  id: string
  name: string
}

interface ShippingMethod {
  id: string
  name: string
}

interface Order {
  id: string
  recipientName: string
  phone: string
  address: string
  postalCode: string | null
  deliveryMessage: string | null
  memo: string | null
  orderDate: string
  orderNumber: string | null
  paymentAmount: string | null
  channel: Channel | null
  shippingMethod: ShippingMethod | null
  items: OrderItem[]
  createdAt: string
}

interface DecryptedPii {
  recipientName: string
  phone: string
  address: string
}

interface OrderDetailTableProps {
  batchId: string
  shippingMethods: ShippingMethod[]
}

const PAGE_SIZE = 50
const NO_VALUE = '__none__'

export function OrderDetailTable({ batchId, shippingMethods }: OrderDetailTableProps) {
  const [orders, setOrders] = useState<Order[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  // 필터
  const [channelFilter, setChannelFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // 인라인 PII 복호화 상태
  const [decryptedRows, setDecryptedRows] = useState<Record<string, DecryptedPii>>({})
  const [decryptingId, setDecryptingId] = useState<string | null>(null)

  // 수정 다이얼로그
  const [editDialog, setEditDialog] = useState<{
    open: boolean
    order: Order | null
    pii: DecryptedPii | null
    loading: boolean
    saving: boolean
  }>({ open: false, order: null, pii: null, loading: false, saving: false })

  // 수정 폼 상태
  const [editForm, setEditForm] = useState({
    recipientName: '',
    phone: '',
    address: '',
    postalCode: '',
    deliveryMessage: '',
    orderDate: '',
    orderNumber: '',
    paymentAmount: '',
    memo: '',
    shippingMethodId: '',
    channelId: '',
    items: [{ name: '', quantity: 1 }] as { name: string; quantity: number }[],
  })

  // batchId 변경 시 필터/페이지 초기화
  const prevBatchId = useRef(batchId)
  useEffect(() => {
    if (prevBatchId.current !== batchId) {
      setPage(1)
      setChannelFilter('all')
      setSearchQuery('')
      setDecryptedRows({})
      prevBatchId.current = batchId
    }
  }, [batchId])

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      const res = await fetch(`/api/del/batches/${batchId}/orders?${params}`)
      if (!res.ok) throw new Error('주문 목록 조회 실패')
      const json = await res.json()
      setOrders(json.data)
      setTotal(json.total)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '주문 목록 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [batchId, page])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  // 채널 목록 추출
  const channels = useMemo(() => {
    const map = new Map<string, string>()
    for (const o of orders) {
      if (o.channel) map.set(o.channel.id, o.channel.name)
    }
    return Array.from(map, ([id, name]) => ({ id, name }))
  }, [orders])

  // 클라이언트 필터링
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (channelFilter !== 'all' && o.channel?.id !== channelFilter) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        if (!o.orderNumber?.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [orders, channelFilter, searchQuery])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // 인라인 PII 복호화
  const handleDecryptInline = async (orderId: string) => {
    if (decryptedRows[orderId]) {
      // 이미 복호화된 경우 토글 (숨기기)
      setDecryptedRows((prev) => {
        const next = { ...prev }
        delete next[orderId]
        return next
      })
      return
    }

    setDecryptingId(orderId)
    try {
      const res = await fetch(`/api/del/orders/${orderId}/decrypt`, { method: 'POST' })
      if (!res.ok) throw new Error('복호화 실패')
      const data: DecryptedPii = await res.json()
      setDecryptedRows((prev) => ({ ...prev, [orderId]: data }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '복호화 실패')
    } finally {
      setDecryptingId(null)
    }
  }

  // PII 셀 렌더링
  const renderPiiCell = (orderId: string, field: keyof DecryptedPii, maskedValue: string) => {
    const decrypted = decryptedRows[orderId]
    const isDecrypting = decryptingId === orderId
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs whitespace-nowrap">
          {decrypted ? decrypted[field] : maskedValue}
        </span>
        <button
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          onClick={() => handleDecryptInline(orderId)}
          disabled={isDecrypting}
          title={decrypted ? '개인정보 숨기기' : '개인정보 보기'}
        >
          {decrypted ? (
            <EyeOff className="h-3 w-3" />
          ) : (
            <Eye className="h-3 w-3" />
          )}
        </button>
      </div>
    )
  }

  // 수정 다이얼로그 열기
  const openEditDialog = async (order: Order) => {
    setEditDialog({ open: true, order, pii: null, loading: true, saving: false })
    try {
      const res = await fetch(`/api/del/orders/${order.id}/decrypt`, { method: 'POST' })
      if (!res.ok) throw new Error('복호화 실패')
      const pii: DecryptedPii = await res.json()
      setEditForm({
        recipientName: pii.recipientName,
        phone: pii.phone,
        address: pii.address,
        postalCode: order.postalCode ?? '',
        deliveryMessage: order.deliveryMessage ?? '',
        orderDate: order.orderDate?.split('T')[0] ?? '',
        orderNumber: order.orderNumber ?? '',
        paymentAmount: order.paymentAmount != null ? String(order.paymentAmount) : '',
        memo: order.memo ?? '',
        shippingMethodId: order.shippingMethod?.id ?? '',
        channelId: order.channel?.id ?? '',
        items: order.items.length > 0
          ? order.items.map((i) => ({ name: i.name, quantity: i.quantity }))
          : [{ name: '', quantity: 1 }],
      })
      setEditDialog({ open: true, order, pii, loading: false, saving: false })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '복호화 실패')
      setEditDialog({ open: false, order: null, pii: null, loading: false, saving: false })
    }
  }

  // 수정 저장
  const handleSaveEdit = async () => {
    if (!editDialog.order) return
    if (!editForm.recipientName || !editForm.phone || !editForm.address) {
      toast.error('받는분, 전화, 주소는 필수입니다')
      return
    }

    setEditDialog((prev) => ({ ...prev, saving: true }))
    try {
      const res = await fetch(`/api/del/orders/${editDialog.order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientName: editForm.recipientName,
          phone: editForm.phone,
          address: editForm.address,
          postalCode: editForm.postalCode || null,
          deliveryMessage: editForm.deliveryMessage || null,
          orderDate: editForm.orderDate,
          orderNumber: editForm.orderNumber || null,
          paymentAmount: editForm.paymentAmount ? Number(editForm.paymentAmount) : null,
          memo: editForm.memo || null,
          shippingMethodId: editForm.shippingMethodId || undefined,
          channelId: editForm.channelId || null,
          items: editForm.items.filter((i) => i.name),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '수정 실패')
      }
      toast.success('주문이 수정되었습니다')
      setEditDialog({ open: false, order: null, pii: null, loading: false, saving: false })
      // 복호화 캐시 제거 (마스킹 데이터가 바뀌므로)
      setDecryptedRows((prev) => {
        const next = { ...prev }
        delete next[editDialog.order!.id]
        return next
      })
      fetchOrders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '수정 실패')
      setEditDialog((prev) => ({ ...prev, saving: false }))
    }
  }

  // 삭제
  const handleDelete = async () => {
    if (!editDialog.order) return
    if (!confirm('이 주문을 삭제하시겠습니까?')) return

    try {
      const res = await fetch(`/api/del/orders/${editDialog.order.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '삭제 실패')
      }
      toast.success('주문이 삭제되었습니다')
      setEditDialog({ open: false, order: null, pii: null, loading: false, saving: false })
      fetchOrders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  const formatAmount = (amount: string | null) => {
    if (!amount) return '-'
    const num = Number(amount)
    if (isNaN(num)) return amount
    return num.toLocaleString('ko-KR') + '원'
  }

  // 상품 항목 추가/제거 (수정 폼)
  const addEditItem = () => {
    if (editForm.items.length >= 10) return
    setEditForm((prev) => ({
      ...prev,
      items: [...prev.items, { name: '', quantity: 1 }],
    }))
  }
  const removeEditItem = (idx: number) => {
    setEditForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx),
    }))
  }
  const updateEditItem = (idx: number, field: 'name' | 'quantity', value: string | number) => {
    setEditForm((prev) => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === idx ? { ...item, [field]: value } : item
      ),
    }))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          주문 목록 <span className="text-muted-foreground font-normal">({total}건)</span>
        </h2>
        <DeliveryFileDialog
          batchId={batchId}
          shippingMethods={shippingMethods}
          disabled={total === 0}
        />
      </div>

      {/* 필터 */}
      <div className="flex gap-2">
        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="판매채널" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 채널</SelectItem>
            {channels.map((ch) => (
              <SelectItem key={ch.id} value={ch.id}>
                {ch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="주문번호 검색"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-[200px]"
        />
      </div>

      {/* 테이블 */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">받는분</TableHead>
              <TableHead className="text-xs">전화</TableHead>
              <TableHead className="text-xs">주소</TableHead>
              <TableHead className="text-xs">판매채널</TableHead>
              <TableHead className="text-xs">주문번호</TableHead>
              <TableHead className="text-xs text-right">결제금액</TableHead>
              <TableHead className="text-xs">상품</TableHead>
              <TableHead className="text-xs">주문일자</TableHead>
              <TableHead className="text-xs">메모</TableHead>
              <TableHead className="text-xs w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-xs text-muted-foreground py-8">
                  로딩 중...
                </TableCell>
              </TableRow>
            ) : filteredOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-xs text-muted-foreground py-8">
                  주문이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              filteredOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>{renderPiiCell(order.id, 'recipientName', order.recipientName)}</TableCell>
                  <TableCell>{renderPiiCell(order.id, 'phone', order.phone)}</TableCell>
                  <TableCell className="max-w-[200px]">
                    <div className="flex items-center gap-1">
                      <span className="text-xs truncate" title={decryptedRows[order.id]?.address ?? order.address}>
                        {decryptedRows[order.id]?.address ?? order.address}
                      </span>
                      {!decryptedRows[order.id] && (
                        <button
                          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          onClick={() => handleDecryptInline(order.id)}
                          disabled={decryptingId === order.id}
                          title="개인정보 보기"
                        >
                          <Eye className="h-3 w-3" />
                        </button>
                      )}
                      {decryptedRows[order.id] && (
                        <button
                          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => handleDecryptInline(order.id)}
                          title="개인정보 숨기기"
                        >
                          <EyeOff className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {order.channel ? (
                      <Badge variant="outline" className="text-xs">
                        {order.channel.name}
                      </Badge>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {order.orderNumber || '-'}
                  </TableCell>
                  <TableCell className="text-xs text-right whitespace-nowrap">
                    {formatAmount(order.paymentAmount)}
                  </TableCell>
                  <TableCell className="text-xs max-w-[160px] truncate">
                    {order.items.map((i) => `${i.name} x${i.quantity}`).join(', ') || '-'}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {formatDate(order.orderDate)}
                  </TableCell>
                  <TableCell className="text-xs max-w-[120px] truncate" title={order.memo ?? ''}>
                    {order.memo || '-'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      title="수정"
                      onClick={() => openEditDialog(order)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            이전
          </Button>
          <span className="text-xs text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            다음
          </Button>
        </div>
      )}

      {/* 수정 다이얼로그 */}
      <Dialog
        open={editDialog.open}
        onOpenChange={(open) => {
          if (!open) setEditDialog({ open: false, order: null, pii: null, loading: false, saving: false })
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>주문 수정</DialogTitle>
          </DialogHeader>
          {editDialog.loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">복호화 중...</div>
          ) : (
            <div className="space-y-4">
              {/* PII 필드 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">받는분 *</Label>
                  <Input
                    className="h-8 text-sm"
                    value={editForm.recipientName}
                    onChange={(e) => setEditForm((f) => ({ ...f, recipientName: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">전화 *</Label>
                  <Input
                    className="h-8 text-sm"
                    value={editForm.phone}
                    onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">주소 *</Label>
                <Input
                  className="h-8 text-sm"
                  value={editForm.address}
                  onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">우편번호</Label>
                  <Input
                    className="h-8 text-sm"
                    value={editForm.postalCode}
                    onChange={(e) => setEditForm((f) => ({ ...f, postalCode: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">주문일자</Label>
                  <Input
                    className="h-8 text-sm"
                    type="date"
                    value={editForm.orderDate}
                    onChange={(e) => setEditForm((f) => ({ ...f, orderDate: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">배송메시지</Label>
                <Input
                  className="h-8 text-sm"
                  value={editForm.deliveryMessage}
                  onChange={(e) => setEditForm((f) => ({ ...f, deliveryMessage: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">주문번호</Label>
                  <Input
                    className="h-8 text-sm"
                    value={editForm.orderNumber}
                    onChange={(e) => setEditForm((f) => ({ ...f, orderNumber: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">결제금액</Label>
                  <Input
                    className="h-8 text-sm"
                    type="number"
                    value={editForm.paymentAmount}
                    onChange={(e) => setEditForm((f) => ({ ...f, paymentAmount: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">배송방식</Label>
                  <Select
                    value={editForm.shippingMethodId || NO_VALUE}
                    onValueChange={(v) =>
                      setEditForm((f) => ({ ...f, shippingMethodId: v === NO_VALUE ? '' : v }))
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_VALUE}>선택</SelectItem>
                      {shippingMethods.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">판매채널</Label>
                  <Select
                    value={editForm.channelId || NO_VALUE}
                    onValueChange={(v) =>
                      setEditForm((f) => ({ ...f, channelId: v === NO_VALUE ? '' : v }))
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_VALUE}>없음</SelectItem>
                      {channels.map((ch) => (
                        <SelectItem key={ch.id} value={ch.id}>{ch.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">메모</Label>
                <Textarea
                  className="text-sm h-16"
                  value={editForm.memo}
                  onChange={(e) => setEditForm((f) => ({ ...f, memo: e.target.value }))}
                />
              </div>

              {/* 상품 */}
              <div className="space-y-2">
                <Label className="text-xs">상품</Label>
                {editForm.items.map((item, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Input
                      className="h-8 text-sm flex-1"
                      placeholder="상품명"
                      value={item.name}
                      onChange={(e) => updateEditItem(idx, 'name', e.target.value)}
                    />
                    <Input
                      className="h-8 text-sm w-20"
                      type="number"
                      min={1}
                      placeholder="수량"
                      value={item.quantity}
                      onChange={(e) => updateEditItem(idx, 'quantity', Number(e.target.value) || 1)}
                    />
                    {editForm.items.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => removeEditItem(idx)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
                {editForm.items.length < 10 && (
                  <Button variant="outline" size="sm" className="text-xs" onClick={addEditItem}>
                    + 상품 추가
                  </Button>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={editDialog.loading || editDialog.saving}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />삭제
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setEditDialog({ open: false, order: null, pii: null, loading: false, saving: false })}
              >
                취소
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={editDialog.loading || editDialog.saving}
              >
                {editDialog.saving ? '저장 중...' : '저장'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
