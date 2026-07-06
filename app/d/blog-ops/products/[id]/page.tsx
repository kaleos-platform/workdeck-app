import { notFound, redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ProductForm } from '@/components/bo/products/product-form'

type Props = {
  params: Promise<{ id: string }>
}

export default async function BlogOpsProductEditPage({ params }: Props) {
  const user = await getUser()
  if (!user) redirect('/login')

  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) redirect('/my-deck')

  const { id } = await params
  const product = await prisma.boProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!product) notFound()

  const features = Array.isArray(product.features) ? (product.features as string[]) : []
  const customFields = Array.isArray(product.customFields)
    ? (product.customFields as { key: string; value: string }[])
    : []

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">제품 편집</h1>
        <p className="text-sm text-muted-foreground">{product.name}</p>
      </div>
      <ProductForm
        mode="edit"
        productId={product.id}
        initial={{
          name: product.name,
          category: (product.category as 'B2B' | 'B2C' | '기타' | undefined) ?? '',
          oneLinerPitch: product.oneLinerPitch ?? '',
          homepageUrl: product.homepageUrl ?? '',
          targetCustomer: product.targetCustomer ?? '',
          ctaUrl: product.ctaUrl ?? '',
          features,
          customFields,
          isActive: product.isActive,
        }}
        crawlStatus={product.crawlStatus as 'NONE' | 'PENDING' | 'DONE' | 'FAILED'}
        crawledAt={product.crawledAt}
        crawledText={product.crawledText}
      />
    </div>
  )
}
