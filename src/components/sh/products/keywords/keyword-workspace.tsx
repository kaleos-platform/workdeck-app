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
  const [tab, setTab] = useState('products')
  const [dictVisited, setDictVisited] = useState(false)

  function handleTabChange(next: string) {
    setTab(next)
    if (next === 'dictionary') setDictVisited(true)
  }

  return (
    <Tabs value={tab} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger value="products">상품별 관리</TabsTrigger>
        <TabsTrigger value="dictionary">키워드 사전</TabsTrigger>
      </TabsList>
      {/* 상품 탭은 언마운트하지 않는다 — 저장 안 한 편집 내용이 탭 전환만으로 사라지면 안 된다. */}
      <TabsContent value="products" forceMount className={tab === 'products' ? 'mt-4' : 'hidden'}>
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
      {/* 사전 탭은 한 번 열기 전까지 마운트하지 않는다 — 안 쓰는 탭의 목록 조회를
          페이지 진입마다 내보내지 않기 위해서. 한 번 열면 그 뒤로는 유지한다. */}
      <TabsContent
        value="dictionary"
        {...(dictVisited ? { forceMount: true as const } : {})}
        className={tab === 'dictionary' ? 'mt-4' : 'hidden'}
      >
        <KeywordMasterView />
      </TabsContent>
    </Tabs>
  )
}
