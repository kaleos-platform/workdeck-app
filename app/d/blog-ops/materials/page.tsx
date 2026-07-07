import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { MaterialsBoard } from '@/components/bo/materials/materials-board'

export default async function BlogOpsMaterialsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) redirect('/my-deck')

  // 제품 목록 (필터용)
  const products = await prisma.boProduct.findMany({
    where: { spaceId: resolved.space.id, isActive: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true },
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">소재 보드</h1>
        <p className="text-sm text-muted-foreground">
          발굴된 블로그 소재 후보를 검토·승인·반려·보관합니다.
        </p>
      </div>

      <MaterialsBoard products={products} />
    </div>
  )
}
