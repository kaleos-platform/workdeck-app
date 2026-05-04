import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Settings2 } from 'lucide-react'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { getSpaceContentAnalytics } from '@/lib/sc/metrics'
import { AnalyticsContentTable } from '@/components/sc/analytics/analytics-content-table'
import type { ChannelOption } from '@/components/sc/analytics/analytics-filters'

export default async function AnalyticsPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const [contents, rawChannels] = await Promise.all([
    getSpaceContentAnalytics(resolved.space.id),
    prisma.salesContentChannel.findMany({
      where: { spaceId: resolved.space.id, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, platform: true, kind: true },
    }),
  ])

  const channels: ChannelOption[] = rawChannels

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">성과 관리</h1>
          <p className="text-sm text-muted-foreground">
            콘텐츠 단위로 게시 성과를 한눈에 파악합니다.
          </p>
        </div>
        <Link
          href="/d/sales-content/settings?tab=rules"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
        >
          <Settings2 className="h-3.5 w-3.5" />
          개선 규칙 관리
        </Link>
      </div>

      {/* 콘텐츠 단위 성과 테이블 */}
      <AnalyticsContentTable contents={contents} channels={channels} />
    </div>
  )
}
