'use client'

import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  loading: boolean
  onRefresh: () => void
}

export function StockStatusHeader({ loading, onRefresh }: Props) {
  return (
    <div className="flex items-end justify-between gap-4">
      <h1 className="text-2xl font-bold tracking-tight">재고 현황</h1>
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        새로고침
      </Button>
    </div>
  )
}
