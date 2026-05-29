'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type SearchOrder = {
  id: string
  recipientName: string
  phone: string
  address: string
  orderNumber: string | null
  orderDate: string
  paymentAmount: string | null
  channel: { id: string; name: string } | null
}

type SearchResponse = {
  data: SearchOrder[]
  total: number
  hasMore: boolean
}

type Props = {
  query: string
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

export function OrderSearchResults({ query }: Props) {
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

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
      // stale 응답 가드 — 응답 파싱 중 다음 검색이 시작됐으면 무시
      if (!controller.signal.aborted && abortRef.current === controller) {
        setResult(json)
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
              <th className="px-3 py-2 font-medium">판매채널</th>
              <th className="px-3 py-2 font-medium">주문일자</th>
              <th className="px-3 py-2 text-right font-medium">결제금액</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="max-w-[140px] min-w-[90px] truncate px-3 py-2">{o.recipientName}</td>
                <td className="px-3 py-2">{o.orderNumber ?? '-'}</td>
                <td className="max-w-[160px] min-w-[130px] truncate px-3 py-2">{o.phone}</td>
                <td className="max-w-[320px] min-w-[240px] truncate px-3 py-2">{o.address}</td>
                <td className="px-3 py-2">{o.channel?.name ?? '-'}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDate(o.orderDate)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {formatAmount(o.paymentAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
