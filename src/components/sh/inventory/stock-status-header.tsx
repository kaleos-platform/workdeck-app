'use client'

import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  snapshotAt: string | null
  loading: boolean
  onRefresh: () => void
}

export function StockStatusHeader({ snapshotAt, loading, onRefresh }: Props) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LiveDot />
          <SnapshotLabel snapshotAt={snapshotAt} />
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">재고 현황</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          창고·3PL·매장에 흩어진 SKU별 최신 재고를 단일 매트릭스로 확인하세요.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </Button>
      </div>
    </div>
  )
}

function LiveDot() {
  return (
    <span className="relative inline-flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  )
}

function SnapshotLabel({ snapshotAt }: { snapshotAt: string | null }) {
  const text = !snapshotAt
    ? 'Live · 데이터 동기화 중'
    : `Live · ${new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(snapshotAt))} KST 기준`

  return <span className="font-mono tracking-wide uppercase">{text}</span>
}
