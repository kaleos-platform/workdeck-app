'use client'

import { ShippingMethodManager } from '@/components/del/shipping-method-manager'

export default function DeliveryShippingPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">배송 방식 관리</h1>
      <ShippingMethodManager />
    </div>
  )
}
