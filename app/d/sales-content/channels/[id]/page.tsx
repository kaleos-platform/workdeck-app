import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ChannelForm } from '@/components/sc/channels/channel-form'
import { CredentialForm } from '@/components/sc/channels/credential-form'
import { NaverCredentialForm } from '@/components/sc/channels/naver-credential-form'
import { SALES_CONTENT_CHANNELS_PATH } from '@/lib/deck-routes'

type Props = { params: Promise<{ id: string }> }

export default async function ChannelDetailPage({ params }: Props) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const { id } = await params
  const [channel, credentials] = await Promise.all([
    prisma.salesContentChannel.findFirst({
      where: { id, spaceId: resolved.space.id },
    }),
    prisma.channelCredential.findMany({
      where: { channelId: id },
      orderBy: { kind: 'asc' },
      select: {
        id: true,
        kind: true,
        expiresAt: true,
        lastVerifiedAt: true,
        lastError: true,
        updatedAt: true,
      },
    }),
  ])
  if (!channel) notFound()

  // 기존 COOKIE 자격증명 존재 여부 (payload 복호화 없이 유무만 확인)
  const hasExistingCookie = credentials.some((c) => c.kind === 'COOKIE')
  const isNaverBlog = channel.platform === 'BLOG_NAVER'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">{channel.name}</h1>
        <Button asChild variant="ghost">
          <Link href={SALES_CONTENT_CHANNELS_PATH}>← 목록</Link>
        </Button>
      </div>
      <ChannelForm
        mode="edit"
        channelId={channel.id}
        initial={{
          name: channel.name,
          platformSlug: channel.platformSlug,
          platform: channel.platform,
          kind: channel.kind,
          publisherMode: channel.publisherMode,
          collectorMode: channel.collectorMode,
          isActive: channel.isActive,
        }}
      />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          자격증명 ({credentials.length}건)
        </h2>
        {credentials.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            등록된 자격증명이 없습니다. 워커가 API/브라우저 로그인을 수행하려면 최소 하나가
            필요합니다.
          </p>
        ) : (
          <div className="space-y-1 text-xs">
            {credentials.map((c) => (
              <div key={c.id} className="rounded border p-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono">{c.kind}</span>
                  <span className="text-muted-foreground">
                    {c.expiresAt
                      ? `만료 ${new Intl.DateTimeFormat('ko-KR').format(c.expiresAt)}`
                      : '만료 없음'}
                  </span>
                </div>
                {c.lastError && <p className="mt-1 text-destructive">최근 오류: {c.lastError}</p>}
              </div>
            ))}
          </div>
        )}

        {/* 네이버 블로그 전용 세션 업로드 폼 (BLOG_NAVER 채널에만 표시) */}
        {isNaverBlog && (
          <NaverCredentialForm channelId={channel.id} hasExistingCredential={hasExistingCookie} />
        )}

        {/* 범용 자격증명 폼 (OAUTH / API_KEY 등 모든 채널) */}
        <CredentialForm channelId={channel.id} />
      </div>
    </div>
  )
}
