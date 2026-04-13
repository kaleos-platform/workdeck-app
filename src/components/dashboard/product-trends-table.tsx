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
import { Badge } from '@/components/ui/badge'
import { TrendingUp, TrendingDown, Minus, Sparkles, Ghost, Loader2, ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type TrendData = {
  current: { orders: number; revenue: number; adCost: number; roas: number | null }
  previous: { orders: number; revenue: number; adCost: number; roas: number | null }
  ordersChange: number
  ordersChangePct: number | null
  revenueChange: number
  revenueChangePct: number | null
  trend: 'up' | 'down' | 'stable' | 'new' | 'gone'
}

type OptionTrend = TrendData & { optionName: string }
type ProductTrend = TrendData & { productName: string; options: OptionTrend[] }

type Props = {
  campaignId: string
  from: string
  to: string
}

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

function TrendBadge({ trend }: { trend: TrendData['trend'] }) {
  const config = TREND_CONFIG[trend]
  const Icon = config.icon
  return (
    <Badge variant="secondary" className={cn('gap-1 text-[10px]', config.className)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  )
}

function DataCells({ data }: { data: TrendData }) {
  return (
    <>
      <TableCell className="text-right">{data.current.orders.toLocaleString()}</TableCell>
      <TableCell className="text-right text-muted-foreground">
        {data.previous.orders.toLocaleString()}
      </TableCell>
      <TableCell className="text-right">
        <ChangeBadge value={data.ordersChange} pct={data.ordersChangePct} />
      </TableCell>
      <TableCell className="text-right">
        {data.current.revenue.toLocaleString()}원
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        {data.previous.revenue.toLocaleString()}원
      </TableCell>
      <TableCell className="text-right">
        <ChangeBadge value={data.revenueChange} pct={data.revenueChangePct} />
      </TableCell>
    </>
  )
}

export function ProductTrendsTable({ campaignId, from, to }: Props) {
  const [trends, setTrends] = useState<ProductTrend[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const fetchData = useCallback(async () => {
    if (!from || !to) return
    setLoading(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/product-trends?from=${from}&to=${to}`)
      if (!res.ok) return
      const data = await res.json()
      setTrends(data.trends ?? [])
    } finally {
      setLoading(false)
    }
  }, [campaignId, from, to])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">상품명</TableHead>
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
                const isOpen = expanded.has(t.productName)
                const hasOptions = t.options.length > 1
                return (
                  <>{/* 상품 합계 행 */}
                    <TableRow
                      key={`product-${i}`}
                      className={cn(hasOptions && 'cursor-pointer hover:bg-muted/50')}
                      onClick={() => hasOptions && toggleExpand(t.productName)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {hasOptions && (
                            isOpen
                              ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <p className="text-sm font-medium">
                            {t.productName}
                            {hasOptions && (
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                ({t.options.length}개 옵션)
                              </span>
                            )}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell><TrendBadge trend={t.trend} /></TableCell>
                      <DataCells data={t} />
                    </TableRow>
                    {/* 옵션별 세부 행 */}
                    {isOpen && t.options.map((opt, j) => (
                      <TableRow key={`option-${i}-${j}`} className="bg-muted/30">
                        <TableCell className="pl-10">
                          <p className="text-xs text-muted-foreground">
                            ㄴ {opt.optionName}
                          </p>
                        </TableCell>
                        <TableCell><TrendBadge trend={opt.trend} /></TableCell>
                        <DataCells data={opt} />
                      </TableRow>
                    ))}
                  </>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
