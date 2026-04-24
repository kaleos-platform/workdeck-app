import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ContentStatusBadge } from '@/components/sc/contents/content-status-badge'
import { SALES_CONTENT_CONTENTS_PATH } from '@/lib/deck-routes'
import { nextAllowed } from '@/lib/sc/content-state'

type Props = { params: Promise<{ id: string }> }

export default async function ContentDetailPage({ params }: Props) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const { id } = await params
  const content = await prisma.content.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: {
      assets: true,
      channel: { select: { id: true, name: true, platform: true } },
    },
  })
  if (!content) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ContentStatusBadge status={content.status} />
            {content.channel && (
              <span className="text-xs text-muted-foreground">
                → {content.channel.name} ({content.channel.platform})
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
    </div>
  )
}
