'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type ChannelSummaryRow = {
  channelId: string
  channelName: string
  totalRevenue: number
  totalOrders: number
  avgOrderAmount: number
  prevMonthRevenue: number
}

function formatKRW(value: number): string {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(value)
}

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

function getPrevMonthRange(): { from: string; to: string } {
  const now = new Date()
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const year = prevMonth.getFullYear()
  const month = String(prevMonth.getMonth() + 1).padStart(2, '0')
  const lastDay = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate()
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
  }
}

export function ChannelRevenueTable() {
  const [rows, setRows] = useState<ChannelSummaryRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const thisMonth = getThisMonthRange()
    const prevMonth = getPrevMonthRange()

    Promise.all([
      fetch(
        `/api/sh/dashboard/revenue?from=${thisMonth.from}&to=${thisMonth.to}&groupBy=channel`
      ).then((res) => (res.ok ? res.json() : null)),
      fetch(
        `/api/sh/dashboard/revenue?from=${prevMonth.from}&to=${prevMonth.to}&groupBy=channel`
      ).then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([thisData, prevData]) => {
        const thisRows: Array<{
          channelId: string
          channelName: string
          totalRevenue: number
          totalOrders: number
        }> = thisData?.channels ?? thisData?.rows ?? []
        const prevMap: Record<string, number> = {}
        ;(prevData?.channels ?? prevData?.rows ?? []).forEach(
          (r: { channelId: string; totalRevenue: number }) => {
            prevMap[r.channelId] = r.totalRevenue
          }
        )

        setRows(
          thisRows.map((r) => ({
            channelId: r.channelId,
            channelName: r.channelName,
            totalRevenue: r.totalRevenue,
            totalOrders: r.totalOrders,
            avgOrderAmount: r.totalOrders > 0 ? Math.round(r.totalRevenue / r.totalOrders) : 0,
            prevMonthRevenue: prevMap[r.channelId] ?? 0,
          }))
        )
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function renderMoM(current: number, prev: number) {
    if (prev === 0) return <span className="text-xs text-muted-foreground">-</span>
    const pct = ((current - prev) / prev) * 100
    const positive = pct >= 0
    return (
      <Badge variant={positive ? 'default' : 'destructive'} className="text-xs">
        {positive ? '+' : ''}
        {pct.toFixed(1)}%
      </Badge>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>채널별 매출 현황 (이번 달)</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">이번 달 매출 데이터가 없습니다</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>채널</TableHead>
                <TableHead className="text-right">매출</TableHead>
                <TableHead className="text-right">주문수</TableHead>
                <TableHead className="text-right">평균 주문액</TableHead>
                <TableHead className="text-right">전월 대비</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.channelId}>
                  <TableCell className="font-medium">{row.channelName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKRW(row.totalRevenue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.totalOrders.toLocaleString('ko-KR')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKRW(row.avgOrderAmount)}
                  </TableCell>
                  <TableCell className="text-right">
                    {renderMoM(row.totalRevenue, row.prevMonthRevenue)}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" asChild>
                      <Link href={`/d/seller-hub/channels/${row.channelId}`} aria-label="채널 상세">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
