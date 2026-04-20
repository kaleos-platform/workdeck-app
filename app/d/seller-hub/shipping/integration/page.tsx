'use client'

import { IntegrationPanel } from '@/components/del/integration-panel'

export default function ShippingIntegrationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">데이터 연동</h1>
        <p className="text-sm text-muted-foreground">채널별 주문 데이터 연동 설정을 관리합니다</p>
      </div>
      <IntegrationPanel />
    </div>
  )
}
