import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ChannelForm } from '@/components/sc/channels/channel-form'
import { SALES_CONTENT_CHANNELS_PATH } from '@/lib/deck-routes'

const PLATFORM_LABEL: Record<string, string> = {
  BLOG_NAVER: '네이버 블로그',
  BLOG_TISTORY: '티스토리',
  BLOG_WORDPRESS: '워드프레스',
  THREADS: 'Threads',
  X: 'X',
  LINKEDIN: 'LinkedIn',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  YOUTUBE_SHORTS: 'YouTube Shorts',
  OTHER: '기타',
}

export default async function ChannelsPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const channels = await prisma.salesContentChannel.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">배포 채널</h1>
        <p className="text-sm text-muted-foreground">
          콘텐츠가 게시될 블로그·소셜 계정 설정. utm_source 는 platformSlug 로 부착됩니다.
        </p>
      </div>

      {channels.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            아직 등록된 배포 채널이 없습니다. 아래 폼으로 첫 채널을 추가하세요.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {channels.map((c) => (
            <Link
              key={c.id}
              href={`${SALES_CONTENT_CHANNELS_PATH}/${c.id}`}
              className="block rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:bg-accent"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{c.name}</h3>
                    {!c.isActive && (
                      <Badge variant="outline" className="text-xs">
                        비활성
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {PLATFORM_LABEL[c.platform] ?? c.platform} · {c.kind} ·{' '}
                    <span className="font-mono">{c.platformSlug}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    배포 {c.publisherMode} · 수집 {c.collectorMode}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">채널 추가</h2>
        <ChannelForm mode="create" />
      </div>

      <div className="flex justify-end">
        <Button asChild variant="ghost">
          <Link href="/d/sales-content/home">← 홈</Link>
        </Button>
      </div>
    </div>
  )
}
