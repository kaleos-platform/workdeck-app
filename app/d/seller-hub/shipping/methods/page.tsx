'use client'

import { ShippingMethodManager } from '@/components/sh/shipping/shipping-method-manager'

export default function ShippingMethodsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">배송 방식 관리</h1>
        <p className="text-sm text-muted-foreground">배송사 및 배송 방식을 등록하고 관리합니다</p>
      </div>
      <ShippingMethodManager />
    </div>
  )
}
