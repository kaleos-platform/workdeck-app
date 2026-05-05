'use client'

import { useSearchParams } from 'next/navigation'

import { ListingCreateForm } from '@/components/sh/products/listings/listing-create-form'

export default function NewListingPage() {
  const sp = useSearchParams()
  const channelId = sp.get('channelId')
  const isDuplicate = Boolean(sp.get('duplicateFromProductId') && sp.get('duplicateFromChannelId'))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          {isDuplicate ? '판매채널 상품 복제' : '새 판매채널 상품'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isDuplicate
            ? '원본 그룹의 정보를 미리 채웠습니다. 채널·이름·가격 등을 검토하고 저장하세요'
            : '상품을 선택하고 속성별로 구성하면 필요한 판매 옵션이 자동으로 만들어집니다'}
        </p>
      </div>
      <ListingCreateForm defaultChannelId={channelId} />
    </div>
  )
}
