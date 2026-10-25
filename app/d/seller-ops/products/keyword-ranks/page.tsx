import { notFound } from 'next/navigation'

import { KeywordRankBoard } from '@/components/sh/products/keywords/keyword-rank-board'
import { RANK_TRACKING_ENABLED } from '@/components/sh/products/keywords/rank-format'

// deck 컨텍스트는 app/d/seller-ops/layout.tsx 에서 이미 해석·리다이렉트한다.
export default function KeywordRanksPage() {
  if (!RANK_TRACKING_ENABLED) notFound()
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">키워드 순위</h1>
        <p className="text-sm text-muted-foreground">
          추적을 켠 판매채널 상품의 등록 키워드가 매일 새벽 검색 순위(자연 순위 100위까지)로
          기록됩니다
        </p>
      </div>
      <KeywordRankBoard />
    </div>
  )
}
