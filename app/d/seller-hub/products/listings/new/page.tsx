'use client'

import { useSearchParams } from 'next/navigation'

import { ListingForm } from '@/components/sh/products/listings/listing-form'

export default function NewListingPage() {
  const sp = useSearchParams()
  const channelId = sp.get('channelId')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">새 판매채널 상품</h1>
        <p className="text-sm text-muted-foreground">
          판매할 상품 옵션을 묶어 채널 전용 상세를 구성합니다
        </p>
      </div>
      <ListingForm mode="create" defaultChannelId={channelId} />
    </div>
  )
}
