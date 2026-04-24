import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ContentList } from '@/components/sc/contents/content-list'
import { SALES_CONTENT_CONTENTS_PATH } from '@/lib/deck-routes'

export default async function ContentsPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const contents = await prisma.content.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      title: true,
      status: true,
      updatedAt: true,
      channel: { select: { id: true, name: true, platform: true } },
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">콘텐츠</h1>
          <p className="text-sm text-muted-foreground">
            템플릿·글감·맥락을 결합해 본문을 제작하고 배포 준비까지 관리합니다.
          </p>
        </div>
        <Button asChild>
          <Link href={`${SALES_CONTENT_CONTENTS_PATH}/new`}>새 콘텐츠</Link>
        </Button>
      </div>
      <ContentList contents={contents} />
    </div>
  )
}
