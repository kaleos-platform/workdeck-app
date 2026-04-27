import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { PersonaList } from '@/components/sc/settings/persona-list'
import { SALES_CONTENT_PERSONAS_PATH } from '@/lib/deck-routes'

export default async function PersonasPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const personas = await prisma.persona.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      jobTitle: true,
      industry: true,
      companySize: true,
      isActive: true,
      updatedAt: true,
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">타겟 페르소나</h1>
          <p className="text-sm text-muted-foreground">
            B2B·B2G 의사결정자의 프로파일을 구조화해 AI 아이데이션의 품질을 높입니다.
          </p>
        </div>
        <Button asChild>
          <Link href={`${SALES_CONTENT_PERSONAS_PATH}/new`}>페르소나 추가</Link>
        </Button>
      </div>
      <PersonaList personas={personas} />
    </div>
  )
}
