'use client'

import { useState } from 'react'
import {
  DashboardFilters,
  type DashboardFilterValues,
} from '@/components/inv/dashboard-filters'
import { DashboardSummary } from '@/components/inv/dashboard-summary'
import { DashboardChart } from '@/components/inv/dashboard-chart'
import { DashboardStockTable } from '@/components/inv/dashboard-stock-table'
import { getLastNDaysRangeKst } from '@/lib/date-range'

export default function InventoryDashboardPage() {
  const [filters, setFilters] = useState<DashboardFilterValues>(() => {
    const range = getLastNDaysRangeKst(7)
    return { from: range.from, to: range.to }
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">통합 재고 관리</h1>
      <DashboardFilters value={filters} onChange={setFilters} />
      <DashboardSummary filters={filters} />
      <DashboardChart filters={filters} />
      <DashboardStockTable filters={filters} />
    </div>
  )
}
