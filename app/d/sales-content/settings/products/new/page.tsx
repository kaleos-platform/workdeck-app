import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { resolveDeckContext } from '@/lib/api-helpers'
import { ProductForm } from '@/components/sc/settings/product-form'
import { SALES_CONTENT_PRODUCTS_PATH } from '@/lib/deck-routes'

export default async function NewProductPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

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
        <h1 className="mt-2 text-2xl font-bold tracking-tight">판매 상품 추가</h1>
      </div>
      <ProductForm mode="create" />
    </div>
  )
}
