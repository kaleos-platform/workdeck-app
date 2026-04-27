import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { getSpaceAnalyticsSummary } from '@/lib/sc/metrics'

export default async function AnalyticsPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const [summary, deployments] = await Promise.all([
    getSpaceAnalyticsSummary(resolved.space.id),
    prisma.contentDeployment.findMany({
      where: { spaceId: resolved.space.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        content: { select: { id: true, title: true } },
        channel: { select: { name: true, platform: true } },
        _count: { select: { clickEvents: true } },
      },
    }),
  ])

  // 각 배포의 지표 합계를 한 번에 가져온다 (N+1 방지).
  const metricRows = await prisma.deploymentMetric.groupBy({
    by: ['deploymentId'],
    where: { deploymentId: { in: deployments.map((d) => d.id) } },
    _sum: {
      impressions: true,
      views: true,
      likes: true,
      externalClicks: true,
    },
  })
  const byDeploymentId = new Map(metricRows.map((r) => [r.deploymentId, r._sum]))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">성과</h1>
        <p className="text-sm text-muted-foreground">
          /c/[slug] 자체 클릭 집계 + 수동/자동 수집된 플랫폼 지표.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="배포 수" value={summary.deploymentCount} />
        <Stat label="내부 클릭" value={summary.totalClicks} />
        <Stat label="노출 합" value={summary.metrics.impressions} />
        <Stat label="조회 합" value={summary.metrics.views} />
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">배포별 상세</h2>
        {deployments.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              아직 배포가 없어 집계할 데이터가 없습니다.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {deployments.map((d) => {
              const sums = byDeploymentId.get(d.id)
              return (
                <Link
                  key={d.id}
                  href={`/d/sales-content/analytics/${d.id}`}
                  className="block rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:bg-accent"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="truncate text-sm font-semibold">{d.content.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {d.channel.name} · /c/{d.shortSlug}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      <div>클릭 {d._count.clickEvents}</div>
                      <div>노출 {sums?.impressions ?? 0}</div>
                      <div>조회 {sums?.views ?? 0}</div>
                      <div>좋아요 {sums?.likes ?? 0}</div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  )
}
