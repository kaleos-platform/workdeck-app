import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ExecuteDeploymentButton } from '@/components/sc/deployments/execute-deployment-button'

type Props = { params: Promise<{ id: string }> }

export default async function DeploymentDetailPage({ params }: Props) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const { id } = await params
  const deployment = await prisma.contentDeployment.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: {
      content: { select: { id: true, title: true, status: true } },
      channel: { select: { id: true, name: true, platform: true, publisherMode: true } },
      _count: { select: { clickEvents: true } },
    },
  })
  if (!deployment) notFound()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const shortUrl = `${appUrl}/c/${deployment.shortSlug}`

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{deployment.status}</Badge>
            <span className="text-xs text-muted-foreground">
              {deployment.channel.name} ({deployment.channel.platform} ·{' '}
              {deployment.channel.publisherMode})
            </span>
          </div>
          <h1 className="mt-2 text-xl font-bold tracking-tight">{deployment.content.title}</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{shortUrl}</p>
        </div>
        <Button asChild variant="ghost">
          <Link href="/d/sales-content/deployments">← 목록</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">UTM 파라미터</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs text-muted-foreground">
          <div>
            utm_source: <span className="font-mono text-foreground">{deployment.utmSource}</span>
          </div>
          <div>
            utm_medium: <span className="font-mono text-foreground">{deployment.utmMedium}</span>
          </div>
          <div>
            utm_campaign:{' '}
            <span className="font-mono text-foreground">{deployment.utmCampaign}</span>
          </div>
          {deployment.utmContent && (
            <div>
              utm_content:{' '}
              <span className="font-mono text-foreground">{deployment.utmContent}</span>
            </div>
          )}
          <div>
            목적지: <span className="font-mono text-foreground">{deployment.targetUrl}</span>
          </div>
          {deployment.platformUrl && (
            <div>
              게시물 URL:{' '}
              <a
                className="text-primary underline"
                href={deployment.platformUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {deployment.platformUrl}
              </a>
            </div>
          )}
          {deployment.errorMessage && (
            <p className="mt-2 text-destructive">오류: {deployment.errorMessage}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">집계</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">클릭 {deployment._count.clickEvents}회</CardContent>
      </Card>

      <ExecuteDeploymentButton
        deploymentId={deployment.id}
        status={deployment.status}
        contentStatus={deployment.content.status}
      />
    </div>
  )
}
