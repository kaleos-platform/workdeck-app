'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProductBasicForm } from '@/components/sh/products/product-basic-form'
import { ProductOptionsTable } from '@/components/sh/products/product-options-table'
import { ProductionBatchTable } from '@/components/sh/products/production-batch-table'

type Props = {
  productId: string
}

export function ProductDetailTabs({ productId }: Props) {
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <Tabs defaultValue="basic">
      <TabsList>
        <TabsTrigger value="basic">기본 정보</TabsTrigger>
        <TabsTrigger value="options">옵션 + 가격</TabsTrigger>
        <TabsTrigger value="batches">생산 차수</TabsTrigger>
      </TabsList>

      <TabsContent value="basic" className="mt-6">
        <ProductBasicForm productId={productId} onSaved={() => setRefreshKey((k) => k + 1)} />
      </TabsContent>

      <TabsContent value="options" className="mt-6">
        <ProductOptionsTable key={refreshKey} productId={productId} />
      </TabsContent>

      <TabsContent value="batches" className="mt-6">
        <ProductionBatchTable productId={productId} />
      </TabsContent>
    </Tabs>
  )
}
