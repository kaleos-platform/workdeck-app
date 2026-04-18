'use client'

import { useState } from 'react'
import {
  DashboardFilters,
  type DashboardFilterValues,
} from '@/components/inv/dashboard-filters'
import { DashboardChart } from '@/components/inv/dashboard-chart'
import { getLastNDaysRangeKst } from '@/lib/date-range'

export default function InventoryDashboardPage() {
  const [filters, setFilters] = useState<DashboardFilterValues>(() => {
    const range = getLastNDaysRangeKst(7)
    return { from: range.from, to: range.to }
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">대시보드</h1>
      <DashboardFilters value={filters} onChange={setFilters} />
      <DashboardChart filters={filters} />
    </div>
  )
}
