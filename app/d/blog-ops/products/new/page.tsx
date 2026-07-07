import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { ProductForm } from '@/components/bo/products/product-form'

export default async function BlogOpsProductNewPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) redirect('/my-deck')

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">제품 추가</h1>
        <p className="text-sm text-muted-foreground">
          블로그 소재 발굴을 위한 제품 정보를 등록하세요.
        </p>
      </div>
      <ProductForm mode="create" />
    </div>
  )
}
