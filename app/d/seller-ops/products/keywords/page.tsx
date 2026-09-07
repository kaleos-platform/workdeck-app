import { KeywordWorkspace } from '@/components/sh/products/keywords/keyword-workspace'

// deck 컨텍스트(resolveDeckContext('seller-hub'))는 app/d/seller-ops/layout.tsx 에서
// 이미 해석·리다이렉트한다. 페이지에서 중복 호출하지 않는다.
export default function KeywordsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">키워드 관리</h1>
        <p className="text-sm text-muted-foreground">
          상품을 고르면 그 상품이 나가는 모든 판매채널의 상품명·검색어를 한 화면에서 관리합니다
        </p>
      </div>
      <KeywordWorkspace />
    </div>
  )
}
