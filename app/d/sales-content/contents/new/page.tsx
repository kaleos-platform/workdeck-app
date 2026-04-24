import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ContentNewForm } from '@/components/sc/contents/content-new-form'
import type { IdeaItem } from '@/lib/sc/ideation'

export default async function NewContentPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const [templates, products, personas, channels, ideations] = await Promise.all([
    prisma.template.findMany({
      where: {
        OR: [{ spaceId: null, isSystem: true }, { spaceId: resolved.space.id }],
        isActive: true,
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, kind: true },
    }),
    prisma.b2BProduct.findMany({
      where: { spaceId: resolved.space.id, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.persona.findMany({
      where: { spaceId: resolved.space.id, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.salesContentChannel.findMany({
      where: { spaceId: resolved.space.id, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.contentIdea.findMany({
      where: { spaceId: resolved.space.id, generatedBy: 'AI' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, ideas: true },
    }),
  ])

  const ideaOptions = ideations.flatMap((it) => {
    const arr = (Array.isArray(it.ideas) ? it.ideas : []) as IdeaItem[]
    return arr.map((idea, i) => ({
      ideationId: it.id,
      ideaIndex: i,
      title: idea.title,
    }))
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">새 콘텐츠</h1>
        <p className="text-sm text-muted-foreground">
          글감·템플릿·맥락을 선택하면 초안이 자동으로 조립됩니다.
        </p>
      </div>
      <ContentNewForm
        templates={templates}
        products={products}
        personas={personas}
        channels={channels}
        ideas={ideaOptions}
      />
    </div>
  )
}
