'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Eye } from 'lucide-react'
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
  Dialog,
  DialogContent,
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

interface OrderItem {
  id: string
  name: string
  quantity: number
}

interface Channel {
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
  orderDate: string
  orderNumber: string | null
  paymentAmount: string | null
  channel: Channel | null
  shippingMethod: { id: string; name: string } | null
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
}

const PAGE_SIZE = 50

export function OrderDetailTable({ batchId }: OrderDetailTableProps) {
  const [orders, setOrders] = useState<Order[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  // 필터
  const [channelFilter, setChannelFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // 개인정보 보기 다이얼로그
  const [piiDialog, setPiiDialog] = useState<{
    open: boolean
    orderId: string | null
    data: DecryptedPii | null
    loading: boolean
  }>({ open: false, orderId: null, data: null, loading: false })

  // batchId 변경 시 필터/페이지 초기화
  const prevBatchId = useRef(batchId)
  useEffect(() => {
    if (prevBatchId.current !== batchId) {
      setPage(1)
      setChannelFilter('all')
      setSearchQuery('')
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

  // 개인정보 복호화 요청
  const handleDecrypt = async (orderId: string) => {
    setPiiDialog({ open: true, orderId, data: null, loading: true })
    try {
      const res = await fetch(`/api/del/orders/${orderId}/decrypt`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('복호화 실패')
      const data: DecryptedPii = await res.json()
      setPiiDialog({ open: true, orderId, data, loading: false })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '복호화 실패')
      setPiiDialog({ open: false, orderId: null, data: null, loading: false })
    }
  }

  const closeDialog = () => {
    setPiiDialog({ open: false, orderId: null, data: null, loading: false })
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          주문 목록 <span className="text-muted-foreground font-normal">({total}건)</span>
        </h2>
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
              <TableHead className="text-xs w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-8">
                  로딩 중...
                </TableCell>
              </TableRow>
            ) : filteredOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-8">
                  주문이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              filteredOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="text-xs whitespace-nowrap">{order.recipientName}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{order.phone}</TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate" title={order.address}>
                    {order.address}
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
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      title="개인정보 보기"
                      onClick={() => handleDecrypt(order.id)}
                    >
                      <Eye className="h-3.5 w-3.5" />
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

      {/* 개인정보 복호화 다이얼로그 */}
      <Dialog open={piiDialog.open} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">개인정보 상세</DialogTitle>
          </DialogHeader>
          {piiDialog.loading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              복호화 중...
            </div>
          ) : piiDialog.data ? (
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground">받는분:</span>{' '}
                <span className="font-medium">{piiDialog.data.recipientName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">전화번호:</span>{' '}
                <span className="font-medium">{piiDialog.data.phone}</span>
              </div>
              <div>
                <span className="text-muted-foreground">주소:</span>{' '}
                <span className="font-medium">{piiDialog.data.address}</span>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
