'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { OrderEditDialog } from '@/components/sh/shipping/order-edit-dialog'

type Channel = { id: string; name: string }
type ShippingMethod = { id: string; name: string }

type SearchItem = { name: string; quantity: number }

type SearchOrder = {
  id: string
  recipientName: string
  phone: string
  address: string
  orderNumber: string | null
  orderDate: string
  paymentAmount: string | null
  postalCode: string | null
  deliveryMessage: string | null
  memo: string | null
  channel: Channel | null
  shippingMethod: ShippingMethod | null
  items: SearchItem[]
}

type DecryptedPii = { recipientName: string; phone: string; address: string }

type SearchResponse = {
  data: SearchOrder[]
  total: number
  hasMore: boolean
}

type Props = {
  query: string
  shippingMethods: ShippingMethod[]
  channels: Channel[]
}

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

const formatAmount = (amount: string | null) => {
  if (!amount) return '-'
  const num = Number(amount)
  if (isNaN(num)) return amount
  return num.toLocaleString('ko-KR') + '원'
}

const summarizeItems = (items: SearchItem[]) => {
  if (items.length === 0) return '-'
  const first = `${items[0].name}${items[0].quantity > 1 ? ` ×${items[0].quantity}` : ''}`
  return items.length > 1 ? `${first} 외 ${items.length - 1}건` : first
}

export function OrderSearchResults({ query, shippingMethods, channels }: Props) {
  const router = useRouter()
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // 인라인 PII 복호화 (order-detail-table 패턴 재사용 — POST /orders/[id]/decrypt)
  const [decryptedRows, setDecryptedRows] = useState<Record<string, DecryptedPii>>({})
  const [decryptingId, setDecryptingId] = useState<string | null>(null)
  // 상세 패널 / 수정 다이얼로그 / 재등록
  const [detailOrder, setDetailOrder] = useState<SearchOrder | null>(null)
  const [editOrder, setEditOrder] = useState<SearchOrder | null>(null)
  const [cloningId, setCloningId] = useState<string | null>(null)

  const handleDecryptInline = async (orderId: string) => {
    if (decryptedRows[orderId]) {
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

  const fetchResults = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`/api/sh/shipping/orders?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
      if (!res.ok) throw new Error('검색에 실패했습니다')
      const json = (await res.json()) as SearchResponse
      if (!controller.signal.aborted && abortRef.current === controller) {
        setResult(json)
        setDecryptedRows({}) // 새 검색 결과 → 복호화 캐시 초기화
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      console.error(err)
      setError(true)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [query])

  useEffect(() => {
    fetchResults()
    return () => abortRef.current?.abort()
  }, [fetchResults])

  // 수정 저장 후 — 복호화 캐시 무효화 + 재조회
  const handleEditSaved = (orderId: string) => {
    setDecryptedRows((prev) => {
      const next = { ...prev }
      delete next[orderId]
      return next
    })
    setDetailOrder(null)
    fetchResults()
  }

  // 재등록 — 완료 건을 DRAFT 묶음에 복제 후 등록 화면으로 이동
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

  if (loading) {
    return (
      <div className="rounded-lg border p-3">
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="text-sm text-muted-foreground">검색 중 오류가 발생했습니다</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={fetchResults}>
          다시 시도
        </Button>
      </div>
    )
  }

  const orders = result?.data ?? []

  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        검색 결과가 없습니다
      </div>
    )
  }

  const detailDec = detailOrder ? decryptedRows[detailOrder.id] : undefined

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span>총 {result?.total ?? orders.length}건</span>
        {result?.hasMore && <span>최대 {orders.length}건만 표시 — 검색어를 좁혀주세요</span>}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">받는분</th>
              <th className="px-3 py-2 font-medium">주문번호</th>
              <th className="px-3 py-2 font-medium">전화</th>
              <th className="px-3 py-2 font-medium">주소</th>
              <th className="px-3 py-2 font-medium">상품</th>
              <th className="px-3 py-2 font-medium">메모</th>
              <th className="px-3 py-2 font-medium">판매채널</th>
              <th className="px-3 py-2 font-medium">주문일자</th>
              <th className="px-3 py-2 text-right font-medium">결제금액</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const dec = decryptedRows[o.id]
              const isDecrypting = decryptingId === o.id
              return (
                <tr
                  key={o.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                  onClick={() => setDetailOrder(o)}
                >
                  <td className="max-w-[160px] min-w-[110px] px-3 py-2">
                    <div className="flex items-start gap-1">
                      <span className="truncate" title={dec?.recipientName ?? o.recipientName}>
                        {dec?.recipientName ?? o.recipientName}
                      </span>
                      <button
                        type="button"
                        className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDecryptInline(o.id)
                        }}
                        disabled={isDecrypting}
                        title={dec ? '개인정보 숨기기' : '개인정보 보기'}
                      >
                        {dec ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">{o.orderNumber ?? '-'}</td>
                  <td
                    className="max-w-[160px] min-w-[130px] truncate px-3 py-2"
                    title={dec?.phone ?? o.phone}
                  >
                    {dec?.phone ?? o.phone}
                  </td>
                  <td
                    className="max-w-[320px] min-w-[240px] truncate px-3 py-2"
                    title={dec?.address ?? o.address}
                  >
                    {dec?.address ?? o.address}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2" title={summarizeItems(o.items)}>
                    {summarizeItems(o.items)}
                  </td>
                  <td className="max-w-[140px] truncate px-3 py-2" title={o.memo ?? ''}>
                    {o.memo || '-'}
                  </td>
                  <td className="px-3 py-2">{o.channel?.name ?? '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(o.orderDate)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {formatAmount(o.paymentAmount)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 상세 패널 */}
      <Dialog open={!!detailOrder} onOpenChange={(open) => !open && setDetailOrder(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>배송 상세</DialogTitle>
          </DialogHeader>
          {detailOrder && (
            <div className="space-y-3 text-sm">
              <DetailRow label="받는분">
                <span>{detailDec?.recipientName ?? detailOrder.recipientName}</span>
                <button
                  type="button"
                  className="ml-2 text-muted-foreground hover:text-foreground"
                  onClick={() => handleDecryptInline(detailOrder.id)}
                  title={detailDec ? '개인정보 숨기기' : '개인정보 보기'}
                >
                  {detailDec ? (
                    <EyeOff className="inline h-3.5 w-3.5" />
                  ) : (
                    <Eye className="inline h-3.5 w-3.5" />
                  )}
                </button>
              </DetailRow>
              <DetailRow label="전화">{detailDec?.phone ?? detailOrder.phone}</DetailRow>
              <DetailRow label="주소">{detailDec?.address ?? detailOrder.address}</DetailRow>
              <DetailRow label="우편번호">{detailOrder.postalCode || '-'}</DetailRow>
              <DetailRow label="주문번호">{detailOrder.orderNumber || '-'}</DetailRow>
              <DetailRow label="주문일자">{formatDate(detailOrder.orderDate)}</DetailRow>
              <DetailRow label="결제금액">{formatAmount(detailOrder.paymentAmount)}</DetailRow>
              <DetailRow label="판매채널">{detailOrder.channel?.name ?? '-'}</DetailRow>
              <DetailRow label="배송방식">{detailOrder.shippingMethod?.name ?? '-'}</DetailRow>
              <DetailRow label="배송메시지">{detailOrder.deliveryMessage || '-'}</DetailRow>
              <DetailRow label="메모">{detailOrder.memo || '-'}</DetailRow>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">상품</div>
                {detailOrder.items.length === 0 ? (
                  <div className="text-muted-foreground">-</div>
                ) : (
                  <ul className="list-disc space-y-0.5 pl-5">
                    {detailOrder.items.map((it, i) => (
                      <li key={i}>
                        {it.name} <span className="text-muted-foreground">×{it.quantity}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!!cloningId}
              onClick={() => detailOrder && handleReregister(detailOrder.id)}
            >
              {cloningId ? '복제 중...' : '배송 등록에 재등록'}
            </Button>
            <Button onClick={() => detailOrder && setEditOrder(detailOrder)}>수정</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 수정 다이얼로그 (공용) */}
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
            items: editOrder.items,
          }}
          shippingMethods={shippingMethods}
          channels={channels}
          onSaved={handleEditSaved}
        />
      )}
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-20 shrink-0 text-xs text-muted-foreground">{label}</div>
      <div className="flex-1 break-keep">{children}</div>
    </div>
  )
}
