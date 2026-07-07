import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { TemplatesManager, type TemplateRow } from '@/components/hiring-posts/templates-manager'

// 상세 템플릿 관리 (생성은 위저드 상세 스텝, 여기서는 이름 변경/삭제)
export default async function TemplatesPage() {
  const resolved = await resolveDeckContext('hiring-posts')
  if ('error' in resolved) redirect('/my-deck')

  const rows = await prisma.hiringDetailTemplate.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { contents: true } } },
  })
  const templates: TemplateRow[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    blockCount: t._count.contents,
    updatedAt: t.updatedAt.toISOString(),
  }))

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">상세 템플릿</h1>
        <p className="text-sm text-muted-foreground">
          공고 상세 스텝에서 “템플릿으로 저장”한 재사용 블록을 관리합니다.
        </p>
      </div>
      <TemplatesManager initialTemplates={templates} />
    </div>
  )
}
