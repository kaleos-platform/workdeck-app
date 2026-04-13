'use client'

import { ProductList } from '@/components/inv/product-list'

export default function InventoryMgmtProductsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">상품 관리</h1>
        <p className="text-sm text-muted-foreground">
          상품과 옵션을 조회·수정할 수 있습니다. 상품은 입고 기록으로 자동 생성됩니다.
        </p>
      </div>
      <ProductList />
    </div>
  )
}
