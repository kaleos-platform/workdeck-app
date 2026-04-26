'use client'

import { LocationManager } from '@/components/sh/inventory/location-manager'

export default function LocationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">보관 장소 관리</h1>
        <p className="text-sm text-muted-foreground">
          재고가 저장되는 보관 장소를 등록하고, 외부 상품 코드 매핑을 확인할 수 있습니다
        </p>
      </div>
      <LocationManager />
    </div>
  )
}
