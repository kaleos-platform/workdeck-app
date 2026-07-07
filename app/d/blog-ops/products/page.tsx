import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { Button } from '@/components/ui/button'
import { ProductList } from '@/components/bo/products/product-list'
import { BLOG_OPS_PRODUCTS_PATH } from '@/lib/deck-routes'

export default async function BlogOpsProductsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) redirect('/my-deck')

  const products = await prisma.boProduct.findMany({
    where: { spaceId: resolved.space.id, isActive: true },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      category: true,
      oneLinerPitch: true,
      homepageUrl: true,
      crawlStatus: true,
      crawledAt: true,
      isActive: true,
      updatedAt: true,
    },
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">제품 관리</h1>
          <p className="text-sm text-muted-foreground">블로그 소재 발굴 대상 제품을 관리합니다.</p>
        </div>
        <Button asChild size="sm">
          <Link href={`${BLOG_OPS_PRODUCTS_PATH}/new`}>제품 추가</Link>
        </Button>
      </div>

      <ProductList products={products} />
    </div>
  )
}
