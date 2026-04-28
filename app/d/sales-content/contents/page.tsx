import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Settings2 } from 'lucide-react'
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">콘텐츠 관리</h1>
          <p className="text-sm text-muted-foreground">
            템플릿·글감·맥락을 결합해 본문을 제작하고 배포 준비까지 관리합니다.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* 개선 규칙 진입 링크 */}
          <Link
            href="/d/sales-content/settings?tab=rules"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
          >
            <Settings2 className="h-3.5 w-3.5" />
            개선 규칙
          </Link>
          <Button asChild>
            <Link href={`${SALES_CONTENT_CONTENTS_PATH}/new`}>새 콘텐츠</Link>
          </Button>
        </div>
      </div>
      <ContentList contents={contents} />
    </div>
  )
}
