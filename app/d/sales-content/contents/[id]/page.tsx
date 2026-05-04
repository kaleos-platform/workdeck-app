import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ContentStatusBadge } from '@/components/sc/contents/content-status-badge'
import { DeployButton } from '@/components/sc/contents/deploy-button'
import { SALES_CONTENT_CONTENTS_PATH, SALES_CONTENT_ANALYTICS_PATH } from '@/lib/deck-routes'
import { nextAllowed } from '@/lib/sc/content-state'
import { getContentMetricsTotal } from '@/lib/sc/metrics'
import { PLATFORM_LABEL } from '@/components/sc/analytics/analytics-filters'
import { ContentMetricsChart } from '@/components/sc/analytics/content-metrics-chart'

type Props = { params: Promise<{ id: string }> }

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────

function numStr(n: number): string {
  return n === 0 ? '—' : n.toLocaleString()
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return '—'
  const date = new Date(d)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ─── 합계 Stats Row ────────────────────────────────────────────────────────

function StatsRow({
  total,
}: {
  total: {
    impressions: number
    views: number
    likes: number
    comments: number
    internalClicks: number
    externalClicks: number
    channelCount: number
  }
}) {
  const stats = [
    { label: '노출', value: total.impressions },
    { label: '조회', value: total.views },
    { label: '좋아요', value: total.likes },
    { label: '댓글', value: total.comments },
    { label: '클릭', value: total.internalClicks + total.externalClicks },
    { label: '게시 채널', value: total.channelCount },
  ]

  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-6">
      {stats.map(({ label, value }) => (
        <div key={label} className="flex flex-col gap-0.5 bg-background px-4 py-3">
          <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
          <span className="text-lg font-semibold tabular-nums">{numStr(value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── 페이지 ────────────────────────────────────────────────────────────────

export default async function ContentDetailPage({ params }: Props) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const { id } = await params
  const [content, channels, deployments, metricsData] = await Promise.all([
    prisma.content.findFirst({
      where: { id, spaceId: resolved.space.id },
      include: {
        assets: true,
        channel: { select: { id: true, name: true, platform: true } },
      },
    }),
    prisma.salesContentChannel.findMany({
      where: { spaceId: resolved.space.id, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, platform: true },
    }),
    prisma.contentDeployment.findMany({
      where: { contentId: id, spaceId: resolved.space.id },
      orderBy: { createdAt: 'desc' },
      include: {
        channel: { select: { id: true, name: true, platform: true, kind: true } },
        _count: { select: { clickEvents: true } },
      },
    }),
    getContentMetricsTotal(id),
  ])
  if (!content) notFound()

  // 배포별 지표 맵 (Bernstein 함수에서 받은 데이터)
  const deploymentMetricsMap = new Map(metricsData.byDeployment.map((d) => [d.deploymentId, d]))

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ContentStatusBadge status={content.status} />
            {content.channel && (
              <span className="text-xs text-muted-foreground">
                → {content.channel.name} ({PLATFORM_LABEL[content.channel.platform]})
              </span>
            )}
          </div>
          <h1 className="mt-2 text-xl font-bold tracking-tight">{content.title}</h1>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href={`${SALES_CONTENT_CONTENTS_PATH}/${content.id}/edit`}>편집</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href={SALES_CONTENT_CONTENTS_PATH}>← 목록</Link>
          </Button>
        </div>
      </div>

      {/* 합계 Stats Row */}
      <StatsRow total={metricsData.total} />

      {/* 일별 추이 차트 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">일별 추이</CardTitle>
        </CardHeader>
        <CardContent>
          <ContentMetricsChart daily={metricsData.daily} />
        </CardContent>
      </Card>

      {/* 다음 상태 전이 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">다음 가능한 상태 전이</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {nextAllowed(content.status).join(', ') || '(없음 — 최종 상태)'}
          </p>
        </CardContent>
      </Card>

      {/* 에셋 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">에셋 {content.assets.length}개</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          {content.assets.length === 0
            ? '연결된 이미지·링크 에셋이 없습니다.'
            : content.assets.map((a) => (
                <div key={a.id} className="py-1">
                  [{a.kind}] {a.title ?? a.url}
                </div>
              ))}
        </CardContent>
      </Card>

      {/* 배포 카드 강화 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">배포 ({deployments.length}건)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {deployments.length === 0 ? (
            <p className="text-xs text-muted-foreground">아직 예약된 배포가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {deployments.map((d) => {
                const dm = deploymentMetricsMap.get(d.id)
                const m = dm?.metrics
                const internalClicks = d._count.clickEvents
                return (
                  <div key={d.id} className="rounded border p-3 text-xs">
                    {/* 배포 헤더 행 */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* 채널 배지 */}
                        <Badge variant="secondary" className="px-1.5 py-0 text-[11px] font-normal">
                          {d.channel.name}
                        </Badge>
                        <span className="font-mono text-muted-foreground">/c/{d.shortSlug}</span>
                        <span
                          className={[
                            'rounded px-1.5 py-0 font-medium',
                            d.status === 'PUBLISHED'
                              ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400'
                              : d.status === 'FAILED'
                                ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400'
                                : 'bg-muted text-muted-foreground',
                          ].join(' ')}
                        >
                          {d.status}
                        </span>
                      </div>
                      <span className="shrink-0 text-muted-foreground">
                        {formatDate(d.publishedAt)}
                      </span>
                    </div>

                    {/* 채널 플랫폼 + URL */}
                    <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                      <span>{PLATFORM_LABEL[d.channel.platform]}</span>
                      {d.targetUrl && <span className="truncate">→ {d.targetUrl}</span>}
                    </div>

                    {/* 채널별 지표 */}
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {(
                        [
                          ['조회', m?.views ?? 0],
                          ['노출', m?.impressions ?? 0],
                          ['좋아요', m?.likes ?? 0],
                          [
                            '클릭',
                            (m?.internalClicks ?? internalClicks) + (m?.externalClicks ?? 0),
                          ],
                        ] as const
                      ).map(([label, val]) => (
                        <div key={label} className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-muted-foreground">{label}</span>
                          <span className="font-medium tabular-nums">
                            {(val as number) === 0 ? '—' : (val as number).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* 분석 자세히 버튼 */}
                    <div className="mt-2">
                      <Link
                        href={`${SALES_CONTENT_ANALYTICS_PATH}/${d.id}`}
                        className="text-[11px] text-primary underline-offset-2 hover:underline"
                      >
                        분석 자세히 →
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <DeployButton
            contentId={content.id}
            contentTitle={content.title}
            defaultChannelId={content.channelId}
            channels={channels}
          />
        </CardContent>
      </Card>
    </div>
  )
}
