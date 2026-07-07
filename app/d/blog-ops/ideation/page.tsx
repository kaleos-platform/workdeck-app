import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { IdeationClient } from '@/components/bo/ideation/ideation-client'

export default async function BlogOpsIdeationPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) redirect('/my-deck')

  // 제품 목록 (활성 제품만)
  const products = await prisma.boProduct.findMany({
    where: { spaceId: resolved.space.id, isActive: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true },
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">소구점 발굴</h1>
        <p className="text-sm text-muted-foreground">
          상품 정보를 AI로 분석해 블로그 소재의 소구점과 소재 후보를 발굴합니다.
        </p>
      </div>

      <IdeationClient products={products} />
    </div>
  )
}
