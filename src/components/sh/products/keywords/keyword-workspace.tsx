'use client'

import { useState } from 'react'

import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { KeywordMasterView } from './keyword-master-view'
import { ProductKeywordPanel } from './product-keyword-panel'
import { ProductRail } from './product-rail'

/**
 * 상품 축이 기본 화면이고, 키워드 사전(마스터)은 탭으로 강등한다.
 * 중복 탐지·금지어 관리는 여전히 필요하지만 일상 작업의 진입점은 아니다.
 */
export function KeywordWorkspace() {
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)

  return (
    <Tabs defaultValue="products">
      <TabsList>
        <TabsTrigger value="products">상품별 관리</TabsTrigger>
        <TabsTrigger value="dictionary">키워드 사전</TabsTrigger>
      </TabsList>
      <TabsContent value="products" className="mt-4">
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <Card className="p-3">
            <ProductRail
              selectedProductId={selectedProductId}
              onSelectProduct={setSelectedProductId}
            />
          </Card>
          <ProductKeywordPanel productId={selectedProductId} />
        </div>
      </TabsContent>
      <TabsContent value="dictionary" className="mt-4">
        <KeywordMasterView />
      </TabsContent>
    </Tabs>
  )
}
