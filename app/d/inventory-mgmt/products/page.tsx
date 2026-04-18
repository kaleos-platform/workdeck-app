'use client'

import { useState } from 'react'
import { ProductList } from '@/components/inv/product-list'
import { ProductCreateDialog } from '@/components/inv/product-create-dialog'

export default function InventoryMgmtProductsPage() {
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">상품 관리</h1>
          <p className="text-sm text-muted-foreground">
            상품과 옵션을 조회·수정할 수 있습니다.
          </p>
        </div>
        <ProductCreateDialog onCreated={() => setRefreshKey((k) => k + 1)} />
      </div>
      <ProductList key={refreshKey} />
    </div>
  )
}
