import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { CoupangMatchingView } from '@/components/sh/products/listings/coupang-matching-view'
import { SELLER_HUB_LISTINGS_PATH } from '@/lib/deck-routes'

type Props = { searchParams: Promise<{ channel?: string }> }

export default async function CoupangMatchingPage({ searchParams }: Props) {
  const { channel } = await searchParams
  return (
    <div className="space-y-4">
      <Link
        href={channel ? `${SELLER_HUB_LISTINGS_PATH}?channel=${channel}` : SELLER_HUB_LISTINGS_PATH}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        판매채널 상품
      </Link>
      <div>
        <h1 className="text-2xl font-bold">상품 매칭</h1>
        <p className="text-sm text-muted-foreground">
          쿠팡 Open API 연동 — 쿠팡 옵션과 판매채널 상품을 연결합니다. 연결된 상품만 가격시뮬에서
          쿠팡 판매가로 반영할 수 있습니다
        </p>
      </div>
      <CoupangMatchingView />
    </div>
  )
}
