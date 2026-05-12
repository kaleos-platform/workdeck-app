import { Suspense } from 'react'
import { StockStatusBoard } from '@/components/sh/inventory/stock-status-board'

export default function StockStatusPage() {
  return (
    <Suspense fallback={null}>
      <StockStatusBoard />
    </Suspense>
  )
}
