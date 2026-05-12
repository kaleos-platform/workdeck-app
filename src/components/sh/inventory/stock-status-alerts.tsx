'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { StockAlert } from './stock-status.types'

type Props = {
  alerts: StockAlert[]
  loading: boolean
}

export function StockStatusAlerts({ alerts, loading }: Props) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          재고 알림
          <span className="text-xs font-normal text-muted-foreground">· 우선순위 순</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">현재 활성 알림이 없습니다</p>
        ) : (
          <ul className="divide-y">
            {alerts.map((a, idx) => (
              <AlertRow key={`${a.optionId}-${idx}`} alert={a} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function AlertRow({ alert }: { alert: StockAlert }) {
  const barClass = alert.severity === 'OUT' ? 'bg-red-500' : 'bg-amber-500'
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className={cn('h-7 w-1 flex-shrink-0 rounded-full', barClass)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-muted-foreground">{alert.sku ?? '—'}</span>
          <span className="truncate text-sm font-medium">{alert.productName}</span>
        </div>
        <div className="text-xs text-muted-foreground">{alert.message}</div>
      </div>
      <RelativeTime iso={alert.occurredAt} />
    </li>
  )
}

function RelativeTime({ iso }: { iso: string }) {
  const text = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

  return (
    <span className="font-mono text-[10px] whitespace-nowrap text-muted-foreground">{text}</span>
  )
}
