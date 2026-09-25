'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, Eye, EyeOff, Pencil } from 'lucide-react'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

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

// 본문·헤더 공용 텍스트 크기. 2xl(1536px+)부터만 키운다 — 1440px 무스크롤을 지키기 위함.
// 상품·수량 셀(order-product-fields)은 배송 등록과 공유하는 컴포넌트라 여기서 제외한다.
const CELL_TEXT = 'text-xs 2xl:text-[13px]'

// 컬럼 폭 — table-fixed 에서만 유효하다. td 의 max-w 는 브라우저가 무시하므로 쓰지 않는다.
// 쌍을 이루는 필드는 한 컬럼에 2줄로 묶어 총 폭을 줄인다(받는분+전화, 주문번호+주문일자).
// 폭은 "흔한 값이 안 잘리는 정도"로만 잡는다. 채널명 등은 길이 제한이 없어 어떤 폭도 언젠가
// 넘치므로, 넘쳤을 때 깨지지 않는 구조(안쪽 요소 truncate + 툴팁)가 본체다.
const COL_RECIPIENT = 'w-[96px] 2xl:w-[104px]'
const COL_ADDRESS = 'w-[186px] 2xl:w-[202px]'
const COL_MESSAGE = 'w-[84px] 2xl:w-[90px]'
const COL_CHANNEL = 'w-[110px] 2xl:w-[124px]'
const COL_ORDER = 'w-[124px] 2xl:w-[134px]'
const COL_AMOUNT = 'w-[78px] 2xl:w-[84px]'
const COL_MEMO = 'w-[64px] 2xl:w-[70px]'
// 버튼 3개(28px) + gap = 88px. padding 16px 를 더해 106px 이상이어야 셀 밖으로 넘치지 않는다.
const COL_ACTIONS = 'w-[106px]'
// 가로 스크롤 중에도 행을 식별하고 액션을 쓸 수 있도록 양끝 컬럼을 고정한다.
// 아래로 지나가는 컬럼이 비쳐 보이면 안 되므로 배경은 반드시 불투명해야 한다.
const STICKY_RECIPIENT = 'sticky left-0 bg-background'
const STICKY_ACTIONS = 'sticky right-0 bg-background'

interface DecryptedPii {
  recipientName: string
  phone: string
  address: string
}

// 잘릴 수 있는 값 — 마우스를 올리면 전문을 보여준다.
// 네이티브 title 은 1초 지연 + 터치 미지원이라 Radix 툴팁을 쓴다.
function TruncatedCell({ value, className }: { value: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('block', className)}>{value}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[320px] break-keep whitespace-normal">
        {value}
      </TooltipContent>
    </Tooltip>
  )
}

interface OrderDetailTableProps {
  batchId: string
  shippingMethods: ShippingMethod[]
}

const PAGE_SIZE = 50

export function OrderDetailTable({ batchId, shippingMethods }: OrderDetailTableProps) {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  // 필터
  const [channelFilter, setChannelFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('') // 입력값 (즉시)
  const [debouncedQuery, setDebouncedQuery] = useState('') // 서버 검색용 (debounce)

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
      setDebouncedQuery('')
      setDecryptedRows({})
      prevBatchId.current = batchId
    }
  }, [batchId])

  // 검색어 debounce 300ms — 서버 검색 키스트로크 폭주 + 한글 IME 조합 보호
  useEffect(() => {
    if (searchQuery === debouncedQuery) return
    const t = setTimeout(() => {
      setDebouncedQuery(searchQuery)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchQuery, debouncedQuery])

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (debouncedQuery) params.set('q', debouncedQuery)
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
  }, [batchId, page, debouncedQuery])

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

  // 클라이언트 필터링 — 검색(q)은 서버 처리, 여기선 채널 필터만
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (channelFilter !== 'all' && o.channel?.id !== channelFilter) return false
      return true
    })
  }, [orders, channelFilter])

  // 검색(q) 시 서버가 전량 반환 — 페이지네이션 비활성
  const totalPages = debouncedQuery ? 1 : Math.ceil(total / PAGE_SIZE)

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

  // 받는분 셀 — 이름/전화를 2줄로 묶는다. 두 줄은 같은 크기·색상으로 표시한다.
  // 복호화 토글(눈 아이콘)은 우측 액션 컬럼에 있다.
  const renderRecipientCell = (order: Order) => {
    const decrypted = decryptedRows[order.id]
    const name = decrypted ? decrypted.recipientName : order.recipientName
    const phone = decrypted ? decrypted.phone : order.phone
    return (
      <div className={cn('min-w-0', CELL_TEXT)}>
        <div className="truncate" title={name}>
          {name}
        </div>
        <div className="truncate" title={phone}>
          {phone}
        </div>
      </div>
    )
  }

  // 수정 다이얼로그 열기
  const openEditDialog = (order: Order) => {
    setEditOrder(order)
  }

  // 재등록 — 완료 건을 DRAFT 묶음에 복제 후 등록 화면으로 이동
  const [cloningId, setCloningId] = useState<string | null>(null)
  const handleReregister = async (orderId: string) => {
    setCloningId(orderId)
    try {
      const res = await fetch(`/api/sh/shipping/orders/${orderId}/clone`, { method: 'POST' })
      if (!res.ok) throw new Error('재등록 실패')
      toast.success('배송 등록 화면에 복제되었습니다')
      router.push('/d/seller-ops/shipping/registration')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '재등록 실패')
    } finally {
      setCloningId(null)
    }
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
          placeholder="주문번호·받는분·전화·주소·상품·결제금액 검색"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-[280px]"
        />
      </div>

      {/* 테이블 */}
      <TooltipProvider>
        <div className="rounded-md border">
          <Table className="min-w-[1110px] table-fixed 2xl:min-w-[1180px]">
            <TableHeader>
              <TableRow>
                <TableHead className={cn(CELL_TEXT, COL_RECIPIENT, STICKY_RECIPIENT, 'z-30')}>
                  받는분 · 전화
                </TableHead>
                <TableHead className={cn(CELL_TEXT, COL_ADDRESS)}>주소</TableHead>
                <TableHead className={cn(CELL_TEXT, COL_MESSAGE)}>배송메시지</TableHead>
                <TableHead className={cn(CELL_TEXT, COL_CHANNEL)}>판매채널</TableHead>
                <TableHead className={cn(CELL_TEXT, COL_ORDER)}>주문번호 · 일자</TableHead>
                <TableHead className={cn(CELL_TEXT, COL_AMOUNT, 'text-right')}>결제금액</TableHead>
                <TableHead className={cn(CELL_TEXT, 'w-[210px]')}>상품</TableHead>
                <TableHead className={cn(CELL_TEXT, 'w-[48px]')}>수량</TableHead>
                <TableHead className={cn(CELL_TEXT, COL_MEMO)}>메모</TableHead>
                <TableHead className={cn(CELL_TEXT, COL_ACTIONS, STICKY_ACTIONS, 'z-30')} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="py-8 text-center text-xs text-muted-foreground"
                  >
                    로딩 중...
                  </TableCell>
                </TableRow>
              ) : filteredOrders.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="py-8 text-center text-xs text-muted-foreground"
                  >
                    주문이 없습니다
                  </TableCell>
                </TableRow>
              ) : (
                filteredOrders.map((order) => (
                  <TableRow key={order.id} className="align-top">
                    <TableCell className={`${COL_RECIPIENT} ${STICKY_RECIPIENT} z-20`}>
                      {renderRecipientCell(order)}
                    </TableCell>
                    <TableCell className={COL_ADDRESS}>
                      {/* 주소는 중요 정보 — clamp 없이 전문을 줄바꿈해 보여준다.
                          TableCell 기본값이 whitespace-nowrap 이라 명시적으로 풀어야 줄바꿈된다.
                          (기존에 주소가 1줄만 보이고 잘리던 근본 원인) */}
                      <span className={cn('block break-keep whitespace-normal', CELL_TEXT)}>
                        {decryptedRows[order.id]?.address ?? order.address}
                      </span>
                    </TableCell>
                    <TableCell className={COL_MESSAGE}>
                      <TruncatedCell
                        value={order.deliveryMessage || '-'}
                        className={cn('line-clamp-2 break-keep whitespace-normal', CELL_TEXT)}
                      />
                    </TableCell>
                    <TableCell className={cn(CELL_TEXT, COL_CHANNEL)}>
                      {order.channel ? (
                        // Badge 는 inline-flex 라 배지 자체의 truncate 는 무효다(ellipsis 미적용).
                        // 안쪽 span 은 flex item 으로 blockify 되어 정상 동작하고, 캡슐 모양도 유지된다.
                        <Badge variant="outline" className={cn('max-w-full', CELL_TEXT)}>
                          <TruncatedCell value={order.channel.name} className="truncate" />
                        </Badge>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className={cn(CELL_TEXT, COL_ORDER)}>
                      <TruncatedCell value={order.orderNumber || '-'} className="truncate" />
                      <div className="truncate">{formatDate(order.orderDate)}</div>
                    </TableCell>
                    <TableCell
                      className={cn(CELL_TEXT, COL_AMOUNT, 'text-right whitespace-nowrap')}
                    >
                      {formatAmount(order.paymentAmount)}
                    </TableCell>
                    <TableCell className="w-[210px] align-top">
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
                    <TableCell className="w-[48px] align-top">
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
                    <TableCell className={COL_MEMO}>
                      <TruncatedCell
                        value={order.memo || '-'}
                        className={cn('line-clamp-2 break-keep whitespace-normal', CELL_TEXT)}
                      />
                    </TableCell>
                    <TableCell className={cn(COL_ACTIONS, STICKY_ACTIONS, 'z-20')}>
                      <div className="flex gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title={decryptedRows[order.id] ? '개인정보 숨기기' : '개인정보 보기'}
                          disabled={decryptingId === order.id}
                          onClick={() => handleDecryptInline(order.id)}
                        >
                          {decryptedRows[order.id] ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="수정"
                          onClick={() => openEditDialog(order)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="배송 등록에 재등록"
                          disabled={cloningId === order.id}
                          onClick={() => handleReregister(order.id)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </TooltipProvider>

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
