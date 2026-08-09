import { prisma } from '@/lib/prisma'
import { TemplatesList } from '@/components/admin/templates-list'

export default async function AdminTemplatesPage() {
  const templates = await prisma.hiringDetailTemplate.findMany({
    where: { spaceId: null, isSample: true },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      imagePath: true,
      updatedAt: true,
      _count: { select: { contents: true } },
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">모집 샘플 템플릿</h1>
        <p className="text-sm text-muted-foreground">
          전 워크스페이스에 공유되는 글로벌 샘플 템플릿을 관리합니다.
        </p>
      </div>
      <TemplatesList
        initialTemplates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          imagePath: t.imagePath,
          updatedAt: t.updatedAt.toISOString(),
          blockCount: t._count.contents,
        }))}
      />
    </div>
  )
}
