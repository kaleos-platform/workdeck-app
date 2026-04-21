'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, ShoppingCart, AlertTriangle, Truck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type RevenueData = {
  totalRevenue: number
  totalOrders: number
}

function formatKRW(value: number): string {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(value)
}

// 이번 달 시작/끝 날짜 계산
function getThisMonthRange(): { from: string; to: string } {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
  }
}

export function RevenueKpiCards() {
  const [revenue, setRevenue] = useState<RevenueData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { from, to } = getThisMonthRange()
    const params = new URLSearchParams({ from, to })
    fetch(`/api/sh/dashboard/revenue?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          // API 응답 shape: { totals: { orderCount, totalRevenue, avgOrder } }
          const totals = data.totals ?? {}
          setRevenue({
            totalRevenue: Number(totals.totalRevenue ?? 0),
            totalOrders: Number(totals.orderCount ?? 0),
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const cards = [
    {
      title: '이번 달 총 매출',
      value: loading ? '...' : formatKRW(revenue?.totalRevenue ?? 0),
      icon: TrendingUp,
      description: '이번 달 전체 채널 합계',
    },
    {
      title: '이번 달 주문 수',
      value: loading ? '...' : `${(revenue?.totalOrders ?? 0).toLocaleString('ko-KR')}건`,
      icon: ShoppingCart,
      description: '이번 달 전체 채널 주문',
    },
    {
      title: '재고 경고',
      value: '-',
      icon: AlertTriangle,
      description: 'Phase 2',
      disabled: true,
    },
    {
      title: '오늘 배송 예정',
      value: '-',
      icon: Truck,
      description: 'Phase 2',
      disabled: true,
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Card key={card.title} className={card.disabled ? 'opacity-60' : undefined}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
              <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
