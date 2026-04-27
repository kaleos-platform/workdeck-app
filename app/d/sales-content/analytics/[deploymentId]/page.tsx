import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { getDeploymentMetricsTotal } from '@/lib/sc/metrics'
import { MetricForm } from '@/components/sc/analytics/metric-form'

type Props = { params: Promise<{ deploymentId: string }> }

export default async function DeploymentAnalyticsPage({ params }: Props) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const { deploymentId } = await params
  const deployment = await prisma.contentDeployment.findFirst({
    where: { id: deploymentId, spaceId: resolved.space.id },
    include: {
      content: { select: { id: true, title: true } },
      channel: { select: { name: true, platform: true } },
      _count: { select: { clickEvents: true } },
    },
  })
  if (!deployment) notFound()

  const { rows, total } = await getDeploymentMetricsTotal(deploymentId)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{deployment.status}</Badge>
            <span className="text-xs text-muted-foreground">
              {deployment.channel.name} · /c/{deployment.shortSlug}
            </span>
          </div>
          <h1 className="mt-2 text-xl font-bold tracking-tight">{deployment.content.title}</h1>
        </div>
        <Button asChild variant="ghost">
          <Link href="/d/sales-content/analytics">← 성과</Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="내부 클릭" value={deployment._count.clickEvents} />
        <Stat label="노출 합" value={total.impressions} />
        <Stat label="조회 합" value={total.views} />
        <Stat label="좋아요" value={total.likes} />
        <Stat label="댓글" value={total.comments} />
        <Stat label="외부 클릭" value={total.externalClicks} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">일별 기록</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 기록된 지표가 없습니다.</p>
          ) : (
            <div className="divide-y text-xs">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-1.5">
                  <span className="font-mono">
                    {new Intl.DateTimeFormat('ko-KR').format(r.date)} · {r.source}
                  </span>
                  <span className="text-muted-foreground">
                    노출 {r.impressions ?? '-'} · 조회 {r.views ?? '-'} · 좋아요 {r.likes ?? '-'} ·
                    외부클릭 {r.externalClicks ?? '-'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <MetricForm deploymentId={deployment.id} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold">{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  )
}
