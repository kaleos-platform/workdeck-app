'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Package, AlertTriangle, PackageX, TrendingUp, Warehouse } from 'lucide-react'

type Summary = {
  snapshotDate: string | null
  totalProducts: number
  outOfStock: number
  lowStock: number
  totalRevenue30d: number
  totalStorageFee: number
}

export function InventorySummaryCards() {
  const [data, setData] = useState<Summary | null>(null)

  useEffect(() => {
    fetch('/api/inventory/summary')
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .catch(() => {})
  }, [])

  if (!data || !data.snapshotDate) return null

  const cards = [
    {
      label: '전체 상품',
      value: data.totalProducts.toLocaleString(),
      icon: Package,
      color: 'text-blue-500',
    },
    {
      label: '품절',
      value: data.outOfStock.toLocaleString(),
      icon: PackageX,
      color: 'text-red-500',
    },
    {
      label: '저재고 (10개 이하)',
      value: data.lowStock.toLocaleString(),
      icon: AlertTriangle,
      color: 'text-yellow-500',
    },
    {
      label: '이번달 매출(30일)',
      value: `${Number(data.totalRevenue30d).toLocaleString()}원`,
      icon: TrendingUp,
      color: 'text-emerald-500',
    },
    {
      label: '이번달 누적 보관료',
      value: `${Number(data.totalStorageFee).toLocaleString()}원`,
      icon: Warehouse,
      color: 'text-orange-500',
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.label}>
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
  )
}
