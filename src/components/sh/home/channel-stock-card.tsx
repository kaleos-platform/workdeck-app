'use client'

import { Store } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SELLER_HUB_LISTINGS_PATH } from '@/lib/deck-routes'
import {
  CardError,
  CardEmpty,
  CardListSkeleton,
  CardFooterLink,
  useCardData,
} from './card-primitives'

type ChannelStockIssues = {
  channelSoldOutCount: number // 채널 품절(가용은 충분)
  availableOutCount: number // 가용 부족·채널 많음 (오버셀 위험)
  mismatchCount: number // 채널재고 != 가용재고 불일치
}

type Row = { label: string; count: number; tone: 'danger' | 'warn' }

export function ChannelStockCard() {
  const { data, loading, error } = useCardData<ChannelStockIssues>(
    '/api/sh/dashboard/channel-stock-issues'
  )

  const rows: Row[] = data
    ? [
        { label: '채널 품절 (가용재고 충분)', count: data.channelSoldOutCount, tone: 'warn' },
        { label: '채널재고 있으나 실재고 부족', count: data.availableOutCount, tone: 'danger' },
        { label: '채널재고·가용재고 불일치', count: data.mismatchCount, tone: 'warn' },
      ]
    : []
  const hasIssue = rows.some((r) => r.count > 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">판매채널 재고</CardTitle>
        <Store className="h-4 w-4 text-muted-foreground" />
      </CardHeader>

      <CardContent className="pb-2">
        {loading ? (
          <CardListSkeleton rows={3} />
        ) : error || !data ? (
          <CardError />
        ) : !hasIssue ? (
          <CardEmpty>채널 재고 이슈가 없습니다.</CardEmpty>
        ) : (
          <ul className="space-y-2" role="list" aria-label="판매채널 재고 이슈">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-foreground">{r.label}</span>
                <span
                  className={`shrink-0 font-semibold tabular-nums ${
                    r.count === 0
                      ? 'text-muted-foreground'
                      : r.tone === 'danger'
                        ? 'text-destructive'
                        : 'text-orange-500'
                  }`}
                >
                  {r.count.toLocaleString('ko-KR')}건
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <CardFooterLink href={SELLER_HUB_LISTINGS_PATH} label="판매채널 상품" />
    </Card>
  )
}
