import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { TemplatesManager, type TemplateRow } from '@/components/hiring-posts/templates-manager'

// 상세 템플릿 관리 (생성은 위저드 상세 스텝, 여기서는 이름 변경/삭제)
export default async function TemplatesPage() {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')

  const rows = await prisma.hiringDetailTemplate.findMany({
    // 샘플은 블록이 1개 이상인 것만 노출 — 어드민에서 만들다 만 빈 샘플이 고객 목록에 뜨는 것 방지.
    // space 소유 템플릿은 무관(사용자가 만든 빈 템플릿도 지금처럼 노출).
    where: {
      OR: [{ spaceId: resolved.space.id }, { isSample: true, contents: { some: {} } }],
    },
    orderBy: [{ isSample: 'asc' }, { updatedAt: 'desc' }],
    include: { _count: { select: { contents: true } } },
  })
  const templates: TemplateRow[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    blockCount: t._count.contents,
    updatedAt: t.updatedAt.toISOString(),
    isSample: t.isSample,
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
