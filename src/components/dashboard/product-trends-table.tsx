'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, TrendingDown, Minus, Sparkles, Ghost, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type TrendItem = {
  productName: string
  optionId: string | null
  current: { orders: number; revenue: number; adCost: number; roas: number | null }
  previous: { orders: number; revenue: number; adCost: number; roas: number | null }
  ordersChange: number
  ordersChangePct: number | null
  revenueChange: number
  revenueChangePct: number | null
  trend: 'up' | 'down' | 'stable' | 'new' | 'gone'
}

type Props = {
  campaignId: string
}

const PERIOD_OPTIONS = [
  { label: '7일', value: 7 },
  { label: '14일', value: 14 },
  { label: '30일', value: 30 },
]

const TREND_CONFIG = {
  up: { icon: TrendingUp, label: '증가', className: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20' },
  down: { icon: TrendingDown, label: '감소', className: 'text-red-600 bg-red-50 dark:bg-red-900/20' },
  stable: { icon: Minus, label: '유지', className: 'text-muted-foreground bg-muted' },
  new: { icon: Sparkles, label: '신규', className: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20' },
  gone: { icon: Ghost, label: '사라짐', className: 'text-gray-500 bg-gray-50 dark:bg-gray-900/20' },
}

function ChangeBadge({ value, pct }: { value: number; pct: number | null }) {
  if (value === 0) return <span className="text-muted-foreground">-</span>
  const isPositive = value > 0
  return (
    <span className={cn('text-xs font-medium', isPositive ? 'text-emerald-600' : 'text-red-600')}>
      {isPositive ? '+' : ''}{value.toLocaleString()}
      {pct != null && (
        <span className="ml-1 text-[10px]">({isPositive ? '+' : ''}{pct}%)</span>
      )}
    </span>
  )
}

export function ProductTrendsTable({ campaignId }: Props) {
  const [period, setPeriod] = useState(7)
  const [trends, setTrends] = useState<TrendItem[]>([])
  const [loading, setLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/product-trends?period=${period}`)
      if (!res.ok) return
      const data = await res.json()
      setTrends(data.trends ?? [])
    } finally {
      setLoading(false)
    }
  }, [campaignId, period])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">비교 기간:</span>
        {PERIOD_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={period === opt.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPeriod(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[180px]">상품명</TableHead>
              <TableHead>트렌드</TableHead>
              <TableHead className="text-right">현재 주문</TableHead>
              <TableHead className="text-right">이전 주문</TableHead>
              <TableHead className="text-right">주문 변화</TableHead>
              <TableHead className="text-right">현재 매출</TableHead>
              <TableHead className="text-right">이전 매출</TableHead>
              <TableHead className="text-right">매출 변화</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : trends.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  상품 데이터가 없습니다
                </TableCell>
              </TableRow>
            ) : (
              trends.map((t, i) => {
                const config = TREND_CONFIG[t.trend]
                const Icon = config.icon
                return (
                  <TableRow key={`${t.productName}-${t.optionId}-${i}`}>
                    <TableCell>
                      <p className="max-w-[250px] truncate text-sm font-medium">
                        {t.productName}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={cn('gap-1 text-[10px]', config.className)}>
                        <Icon className="h-3 w-3" />
                        {config.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{t.current.orders.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {t.previous.orders.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <ChangeBadge value={t.ordersChange} pct={t.ordersChangePct} />
                    </TableCell>
                    <TableCell className="text-right">
                      {t.current.revenue.toLocaleString()}원
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {t.previous.revenue.toLocaleString()}원
                    </TableCell>
                    <TableCell className="text-right">
                      <ChangeBadge value={t.revenueChange} pct={t.revenueChangePct} />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
