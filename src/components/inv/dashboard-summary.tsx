'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Package,
  Layers,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
} from 'lucide-react'
import type { DashboardFilterValues } from './dashboard-filters'

type SummaryResponse = {
  totalSkus: number
  totalStockUnits: number
  negativeStockSkus: number
  todayInbound: number
  todayOutbound: number
  movementsByLocation: { locationId: string; locationName: string; stockUnits: number }[]
}

interface Props {
  filters: DashboardFilterValues
}

function buildQuery(filters: DashboardFilterValues): string {
  const p = new URLSearchParams()
  if (filters.locationId) p.set('locationId', filters.locationId)
  if (filters.channelId) p.set('channelId', filters.channelId)
  if (filters.channelGroupId) p.set('channelGroupId', filters.channelGroupId)
  if (filters.from) p.set('from', filters.from)
  if (filters.to) p.set('to', filters.to)
  if (filters.movementTypes?.length) p.set('movementTypes', filters.movementTypes.join(','))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function DashboardSummary({ filters }: Props) {
  const [data, setData] = useState<SummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/inv/dashboard/summary${buildQuery(filters)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string }
          throw new Error(body.message ?? '요약 정보를 불러오지 못했습니다')
        }
        return (await res.json()) as SummaryResponse
      })
      .then((json) => {
        if (cancelled) return
        setData(json)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filters])

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-7 w-24 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    )
  }

  if (!data) return null

  const cards = [
    {
      label: '전체 SKU',
      value: data.totalSkus.toLocaleString(),
      icon: Package,
      color: 'text-blue-500',
    },
    {
      label: '전체 재고',
      value: `${data.totalStockUnits.toLocaleString()} 개`,
      icon: Layers,
      color: 'text-emerald-500',
    },
    {
      label: '마이너스 재고',
      value: data.negativeStockSkus.toLocaleString(),
      icon: AlertTriangle,
      color: data.negativeStockSkus > 0 ? 'text-red-500' : 'text-muted-foreground',
      highlight: data.negativeStockSkus > 0,
    },
    {
      label: '오늘 입고',
      value: `${data.todayInbound.toLocaleString()} 개`,
      icon: ArrowDownToLine,
      color: 'text-green-600',
    },
    {
      label: '오늘 출고',
      value: `${data.todayOutbound.toLocaleString()} 개`,
      icon: ArrowUpFromLine,
      color: 'text-rose-600',
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <Card
            key={c.label}
            className={c.highlight ? 'border-red-300 bg-red-50 dark:bg-red-950/20' : undefined}
          >
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`rounded-lg bg-muted p-2 ${c.color}`}>
                <c.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{c.label}</p>
                <p className="text-2xl font-bold">{c.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

    </div>
  )
}
