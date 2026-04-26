'use client'

import { useSearchParams } from 'next/navigation'

import { ListingCreateForm } from '@/components/sh/products/listings/listing-create-form'

export default function NewListingPage() {
  const sp = useSearchParams()
  const channelId = sp.get('channelId')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">새 판매채널 상품</h1>
        <p className="text-sm text-muted-foreground">
          상품을 선택하고 속성별로 구성하면 필요한 listing이 자동으로 만들어집니다
        </p>
      </div>
      <ListingCreateForm defaultChannelId={channelId} />
    </div>
  )
}
