import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { IdeationForm } from '@/components/sc/ideation/ideation-form'
import { IdeationList } from '@/components/sc/ideation/ideation-list'
import type { IdeaCardData } from '@/components/sc/ideation/idea-card'

export default async function IdeationPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const [products, personas, brandProfile, ideations] = await Promise.all([
    prisma.b2BProduct.findMany({
      where: { spaceId: resolved.space.id, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    }),
    prisma.persona.findMany({
      where: { spaceId: resolved.space.id, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    }),
    prisma.brandProfile.findUnique({
      where: { spaceId: resolved.space.id },
      select: { id: true },
    }),
    prisma.contentIdea.findMany({
      where: { spaceId: resolved.space.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        userPromptInput: true,
        generatedBy: true,
        providerName: true,
        createdAt: true,
        ideas: true,
        product: { select: { id: true, name: true, slug: true } },
        persona: { select: { id: true, name: true, slug: true } },
      },
    }),
  ])

  const listRows = ideations.map((it) => {
    const ideasArr = (Array.isArray(it.ideas) ? it.ideas : []) as IdeaCardData[]
    return {
      id: it.id,
      userPromptInput: it.userPromptInput,
      generatedBy: it.generatedBy,
      providerName: it.providerName,
      createdAt: it.createdAt,
      product: it.product,
      persona: it.persona,
      ideaCount: ideasArr.length,
      firstTitle: ideasArr[0]?.title ?? null,
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">아이데이션</h1>
        <p className="text-sm text-muted-foreground">
          상품·페르소나·브랜드 맥락을 바탕으로 글감 후보를 생성합니다.
        </p>
      </div>

      <IdeationForm
        products={products}
        personas={personas}
        brandConfigured={brandProfile != null}
      />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">최근 아이데이션</h2>
        <IdeationList ideations={listRows} />
      </div>
    </div>
  )
}
