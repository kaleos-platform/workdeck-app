import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: '예약',
  PUBLISHING: '게시 중',
  PUBLISHED: '게시됨',
  FAILED: '실패',
  CANCELED: '취소',
}

export default async function DeploymentsPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const deployments = await prisma.contentDeployment.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      content: { select: { id: true, title: true } },
      channel: { select: { name: true, platform: true } },
      _count: { select: { clickEvents: true } },
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">배포 내역</h1>
        <p className="text-sm text-muted-foreground">
          콘텐츠를 어느 채널에 어떤 UTM 으로 보낼지 관리합니다. 클릭 수는 /c/[slug] 리다이렉터가
          집계합니다.
        </p>
      </div>

      {deployments.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            아직 예약된 배포가 없습니다. 콘텐츠 상세에서 &quot;배포 예약&quot; 을 실행하세요.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {deployments.map((d) => (
            <Card key={d.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{STATUS_LABEL[d.status] ?? d.status}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {d.channel.name} · {d.channel.platform}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · 클릭 {d._count.clickEvents}
                      </span>
                    </div>
                    <h3 className="mt-1.5 truncate text-sm font-semibold">{d.content.title}</h3>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      /c/{d.shortSlug} → {d.targetUrl}
                    </p>
                  </div>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/d/sales-content/contents/${d.content.id}`}>콘텐츠</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
