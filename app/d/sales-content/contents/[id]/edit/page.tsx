import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ContentEditor } from '@/components/sc/contents/content-editor'
import { VersionHistoryPanel } from '@/components/sc/contents/version-history-panel'
import { nextAllowed } from '@/lib/sc/content-state'
import { SALES_CONTENT_CONTENTS_PATH } from '@/lib/deck-routes'

type Props = { params: Promise<{ id: string }> }

export default async function EditContentPage({ params }: Props) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const { id } = await params
  const [content, latestVersion] = await Promise.all([
    prisma.content.findFirst({
      where: { id, spaceId: resolved.space.id },
    }),
    prisma.contentVersion.findFirst({
      where: { contentId: id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    }),
  ])
  if (!content) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <h1 className="text-xl font-bold tracking-tight">콘텐츠 편집</h1>
        <Button asChild variant="ghost">
          <Link href={`${SALES_CONTENT_CONTENTS_PATH}/${content.id}`}>← 상세</Link>
        </Button>
      </div>
      <ContentEditor
        contentId={content.id}
        initialTitle={content.title}
        initialDoc={content.doc}
        status={content.status}
        nextAllowed={nextAllowed(content.status)}
      />
      <VersionHistoryPanel
        contentId={content.id}
        currentVersionNumber={latestVersion?.versionNumber}
      />
    </div>
  )
}
