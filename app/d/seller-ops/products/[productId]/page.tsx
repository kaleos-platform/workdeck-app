import { ProductDetailTabs } from '@/components/sh/products/product-detail-tabs'

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>
}) {
  const { productId } = await params

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">상품 상세</h1>
        <p className="text-sm text-muted-foreground">
          기본 정보, 옵션 및 가격, 생산 차수를 관리합니다
        </p>
      </div>
      <ProductDetailTabs productId={productId} />
    </div>
  )
}
