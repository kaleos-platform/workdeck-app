import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ProductList } from '@/components/sc/settings/product-list'
import { SALES_CONTENT_PRODUCTS_PATH } from '@/lib/deck-routes'

export default async function ProductsPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const products = await prisma.b2BProduct.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      oneLinerPitch: true,
      isActive: true,
      updatedAt: true,
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">판매 상품</h1>
          <p className="text-sm text-muted-foreground">
            아이데이션·콘텐츠 생성의 기반이 되는 B2B·B2G 판매 상품 정보를 관리합니다.
          </p>
        </div>
        <Button asChild>
          <Link href={`${SALES_CONTENT_PRODUCTS_PATH}/new`}>상품 추가</Link>
        </Button>
      </div>
      <ProductList products={products} />
    </div>
  )
}
