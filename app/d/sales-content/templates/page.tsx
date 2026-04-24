import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { TemplateList } from '@/components/sc/templates/template-list'
import { SALES_CONTENT_TEMPLATES_PATH } from '@/lib/deck-routes'

export default async function TemplatesPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const templates = await prisma.template.findMany({
    where: {
      OR: [{ spaceId: null, isSystem: true }, { spaceId: resolved.space.id }],
    },
    orderBy: [{ isSystem: 'desc' }, { kind: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      isSystem: true,
      isActive: true,
      updatedAt: true,
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">템플릿</h1>
          <p className="text-sm text-muted-foreground">
            콘텐츠 제작 skeleton 을 정의하는 섹션 구조. 시스템 템플릿은 복제해서 사용하세요.
          </p>
        </div>
        <Button asChild>
          <Link href={`${SALES_CONTENT_TEMPLATES_PATH}/new`}>새 템플릿</Link>
        </Button>
      </div>
      <TemplateList templates={templates} />
    </div>
  )
}
