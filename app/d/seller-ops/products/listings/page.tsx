import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { ListingsTwoPane } from '@/components/sh/products/listings/listings-two-pane'
import { SELLER_HUB_COUPANG_MATCHING_PATH } from '@/lib/deck-routes'

export default function ListingsPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">판매채널 상품</h1>
          <p className="text-sm text-muted-foreground">채널별로 판매할 상품 묶음을 구성합니다</p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href={SELLER_HUB_COUPANG_MATCHING_PATH}>쿠팡 상품 매칭</Link>
        </Button>
      </div>
      <ListingsTwoPane />
    </div>
  )
}
