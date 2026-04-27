import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ProductForm } from '@/components/sc/settings/product-form'
import { SALES_CONTENT_PRODUCTS_PATH } from '@/lib/deck-routes'

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const { id } = await params
  const product = await prisma.b2BProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!product) notFound()

  const initial = {
    name: product.name,
    slug: product.slug,
    oneLinerPitch: product.oneLinerPitch ?? '',
    valueProposition: product.valueProposition ?? '',
    targetCustomers: product.targetCustomers ?? '',
    keyFeatures: (product.keyFeatures as string[] | null) ?? [],
    differentiators: (product.differentiators as string[] | null) ?? [],
    painPointsAddressed: (product.painPointsAddressed as string[] | null) ?? [],
    pricingModel: product.pricingModel ?? '',
    priceMin: product.priceMin?.toString() ?? '',
    priceMax: product.priceMax?.toString() ?? '',
    ctaTargetUrl: product.ctaTargetUrl ?? '',
    isActive: product.isActive,
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={SALES_CONTENT_PRODUCTS_PATH}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          판매 상품 목록으로
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{product.name}</h1>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">/{product.slug}</p>
      </div>
      <ProductForm mode="edit" productId={product.id} initial={initial} />
    </div>
  )
}
