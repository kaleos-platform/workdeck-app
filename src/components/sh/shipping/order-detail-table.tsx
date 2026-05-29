'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, Pencil } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { DeliveryFileDialog } from '@/components/sh/shipping/delivery-file-dialog'
import {
  OrderProductNamesCell,
  OrderProductQtyCell,
  type OrderProduct,
} from '@/components/sh/shipping/order-product-fields'
import { ProductMatchDialog } from '@/components/sh/shipping/product-match-dialog'
import { OrderEditDialog } from '@/components/sh/shipping/order-edit-dialog'

interface OrderItemOption {
  id: string
  name: string
  product?: {
    id: string
    name: string
    internalName?: string | null
    displayName?: string | null
  } | null
}

interface OrderItemListing {
  id: string
  searchName: string
  displayName: string
}

interface OrderItemFulfillment {
  id: string
  optionId: string
  quantity: number
  optionName: string
  productName: string
}

interface OrderItem {
  id: string
  name: string
  quantity: number
  optionId?: string | null
  listingId?: string | null
  option?: OrderItemOption | null
  listing?: OrderItemListing | null
  fulfillments?: OrderItemFulfillment[]
}

function toOrderProducts(items: OrderItem[]): OrderProduct[] {
  return items.map((i) => ({
    name: i.name,
    quantity: i.quantity,
    itemId: i.id,
    optionId: i.option?.id ?? null,
    listingId: i.listing?.id ?? null,
    matched: i.option
      ? {
          optionId: i.option.id,
          productName:
            i.option.product?.displayName ??
            i.option.product?.internalName ??
            i.option.product?.name ??
            '',
          optionName: i.option.name,
        }
      : null,
    fulfillments: (i.fulfillments ?? []).map((f) => ({
      optionId: f.optionId,
      productName: f.productName,
      optionName: f.optionName,
      quantity: f.quantity,
    })),
  }))
}

interface Channel {
  id: string
  name: string
}

interface ShippingMethod {
  id: string
  name: string
  defaultSplitMode?: 'order' | 'option'
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

// 주요 필드 폭 — 내용 많을 때 2줄 clamp 처리
const COL_RECIPIENT = 'min-w-[90px] max-w-[140px]'
const COL_PHONE = 'min-w-[130px] max-w-[160px]'
const COL_ADDRESS = 'min-w-[240px] max-w-[320px]'
const COL_MESSAGE = 'min-w-[160px] max-w-[240px]'

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

  // 수정 다이얼로그 — PII 복호화/폼 상태는 OrderEditDialog 내부에서 관리
  const [editOrder, setEditOrder] = useState<Order | null>(null)

  // 매칭 다이얼로그 상태
  const [matchTarget, setMatchTarget] = useState<{
    orderId: string
    itemId: string
    itemIndex: number
    rawName: string
    orderQty: number
    channelId: string | null
  } | null>(null)

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
      const res = await fetch(`/api/sh/shipping/batches/${batchId}/orders?${params}`)
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
      const res = await fetch(`/api/sh/shipping/orders/${orderId}/decrypt`, { method: 'POST' })
      if (!res.ok) throw new Error('복호화 실패')
      const data: DecryptedPii = await res.json()
      setDecryptedRows((prev) => ({ ...prev, [orderId]: data }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '복호화 실패')
    } finally {
      setDecryptingId(null)
    }
  }

  // PII 셀 렌더링 (길면 2줄 clamp + 툴팁으로 전체 확인)
  const renderPiiCell = (orderId: string, field: keyof DecryptedPii, maskedValue: string) => {
    const decrypted = decryptedRows[orderId]
    const isDecrypting = decryptingId === orderId
    const value = decrypted ? decrypted[field] : maskedValue
    return (
      <div className="flex items-start gap-1">
        <span className="line-clamp-2 text-xs break-keep" title={value}>
          {value}
        </span>
        <button
          className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          onClick={() => handleDecryptInline(orderId)}
          disabled={isDecrypting}
          title={decrypted ? '개인정보 숨기기' : '개인정보 보기'}
        >
          {decrypted ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
      </div>
    )
  }

  // 수정 다이얼로그 열기
  const openEditDialog = (order: Order) => {
    setEditOrder(order)
  }

  // 수정/삭제 후 — 복호화 캐시 무효화 + 재조회
  const handleEditSaved = (orderId: string) => {
    setDecryptedRows((prev) => {
      const next = { ...prev }
      delete next[orderId]
      return next
    })
    fetchOrders()
  }

  // 수량 즉시 반영
  const handleItemPatch = useCallback(
    async (orderId: string, itemId: string, patch: { quantity: number }) => {
      try {
        const res = await fetch(`/api/sh/shipping/orders/${orderId}/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.message ?? '수량 변경 실패')
        }
        const data = await res.json()
        if (data.noChange) return
        setOrders((prev) =>
          prev.map((o) =>
            o.id !== orderId
              ? o
              : {
                  ...o,
                  items: o.items.map((it) =>
                    it.id !== itemId
                      ? it
                      : {
                          ...it,
                          quantity: data.item.quantity,
                          fulfillments: data.item.fulfillments,
                        }
                  ),
                }
          )
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '수량 변경 실패')
      }
    },
    []
  )

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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          주문 목록 <span className="font-normal text-muted-foreground">({total}건)</span>
        </h2>
        <DeliveryFileDialog batchId={batchId} disabled={total === 0} />
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
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={`text-xs ${COL_RECIPIENT}`}>받는분</TableHead>
              <TableHead className={`text-xs ${COL_PHONE}`}>전화</TableHead>
              <TableHead className={`text-xs ${COL_ADDRESS}`}>주소</TableHead>
              <TableHead className={`text-xs ${COL_MESSAGE}`}>배송메시지</TableHead>
              <TableHead className="text-xs">판매채널</TableHead>
              <TableHead className="text-xs">주문번호</TableHead>
              <TableHead className="text-right text-xs">결제금액</TableHead>
              <TableHead className="text-xs">상품</TableHead>
              <TableHead className="text-xs">수량</TableHead>
              <TableHead className="text-xs">주문일자</TableHead>
              <TableHead className="text-xs">메모</TableHead>
              <TableHead className="w-[60px] text-xs" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={12} className="py-8 text-center text-xs text-muted-foreground">
                  로딩 중...
                </TableCell>
              </TableRow>
            ) : filteredOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="py-8 text-center text-xs text-muted-foreground">
                  주문이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              filteredOrders.map((order) => (
                <TableRow key={order.id} className="align-top">
                  <TableCell className={COL_RECIPIENT}>
                    {renderPiiCell(order.id, 'recipientName', order.recipientName)}
                  </TableCell>
                  <TableCell className={COL_PHONE}>
                    {renderPiiCell(order.id, 'phone', order.phone)}
                  </TableCell>
                  <TableCell className={COL_ADDRESS}>
                    <div className="flex items-start gap-1">
                      <span
                        className="line-clamp-2 text-xs break-keep"
                        title={decryptedRows[order.id]?.address ?? order.address}
                      >
                        {decryptedRows[order.id]?.address ?? order.address}
                      </span>
                      <button
                        className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                        onClick={() => handleDecryptInline(order.id)}
                        disabled={decryptingId === order.id}
                        title={decryptedRows[order.id] ? '개인정보 숨기기' : '개인정보 보기'}
                      >
                        {decryptedRows[order.id] ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className={COL_MESSAGE}>
                    <span
                      className="line-clamp-2 text-xs break-keep"
                      title={order.deliveryMessage ?? ''}
                    >
                      {order.deliveryMessage || '-'}
                    </span>
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
                  <TableCell className="text-right text-xs whitespace-nowrap">
                    {formatAmount(order.paymentAmount)}
                  </TableCell>
                  <TableCell className="max-w-[280px] min-w-[200px] align-top">
                    {order.items.length === 0 ? (
                      <span className="text-xs">-</span>
                    ) : (
                      <OrderProductNamesCell
                        value={toOrderProducts(order.items)}
                        onChange={() => {}}
                        allowAdd={false}
                        allowRemove={false}
                        allowNameEdit={false}
                        matchEnabled={!!order.channel}
                        onOpenMatch={(idx) => {
                          const item = order.items[idx]
                          if (!item) return
                          setMatchTarget({
                            orderId: order.id,
                            itemId: item.id,
                            itemIndex: idx,
                            rawName: item.name,
                            orderQty: item.quantity,
                            channelId: order.channel?.id ?? null,
                          })
                        }}
                        onClearMatch={async (idx) => {
                          const item = order.items[idx]
                          if (!item) return
                          try {
                            const res = await fetch(
                              `/api/sh/shipping/orders/${order.id}/items/${item.id}/match`,
                              {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ mode: 'clear' }),
                              }
                            )
                            if (!res.ok) {
                              const data = await res.json().catch(() => ({}))
                              throw new Error(data?.message ?? '매칭 해제 실패')
                            }
                            fetchOrders()
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : '매칭 해제 실패')
                          }
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell className="w-[80px] align-top">
                    {order.items.length === 0 ? (
                      <span className="text-xs">-</span>
                    ) : (
                      <OrderProductQtyCell
                        value={toOrderProducts(order.items)}
                        onChange={() => {}}
                        onItemPatch={(itemId, patch) => handleItemPatch(order.id, itemId, patch)}
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {formatDate(order.orderDate)}
                  </TableCell>
                  <TableCell className="max-w-[200px] min-w-[120px]">
                    <span className="line-clamp-2 text-xs break-keep" title={order.memo ?? ''}>
                      {order.memo || '-'}
                    </span>
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

      {/* 수정 다이얼로그 (공용 컴포넌트) */}
      {editOrder && (
        <OrderEditDialog
          orderId={editOrder.id}
          open={!!editOrder}
          onOpenChange={(open) => {
            if (!open) setEditOrder(null)
          }}
          initial={{
            postalCode: editOrder.postalCode,
            deliveryMessage: editOrder.deliveryMessage,
            orderDate: editOrder.orderDate,
            orderNumber: editOrder.orderNumber,
            paymentAmount: editOrder.paymentAmount,
            memo: editOrder.memo,
            shippingMethodId: editOrder.shippingMethod?.id ?? null,
            channelId: editOrder.channel?.id ?? null,
            items: editOrder.items.map((i) => ({ name: i.name, quantity: i.quantity })),
          }}
          shippingMethods={shippingMethods}
          channels={channels}
          onSaved={handleEditSaved}
          onDeleted={handleEditSaved}
        />
      )}

      {/* 상품 옵션 매칭 다이얼로그 */}
      {matchTarget && (
        <ProductMatchDialog
          open={!!matchTarget}
          onOpenChange={(v) => {
            if (!v) setMatchTarget(null)
          }}
          orderId={matchTarget.orderId}
          itemId={matchTarget.itemId}
          rawName={matchTarget.rawName}
          orderQty={matchTarget.orderQty}
          channelId={matchTarget.channelId}
          channelName={orders.find((o) => o.id === matchTarget.orderId)?.channel?.name ?? null}
          channelSet={!!matchTarget.channelId}
          onMatched={() => {
            setMatchTarget(null)
            // 매칭 결과로 fulfillments가 완전히 교체되므로 전체 재조회가 가장 안전
            fetchOrders()
          }}
        />
      )}
    </div>
  )
}
