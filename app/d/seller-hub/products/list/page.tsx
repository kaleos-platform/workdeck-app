import { ShProductList } from '@/components/sh/products/product-list'

export default function ProductListPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">상품 목록</h1>
        <p className="text-sm text-muted-foreground">등록된 상품과 옵션을 조회하고 관리합니다</p>
      </div>
      <ShProductList />
    </div>
  )
}
