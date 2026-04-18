'use client'

import { IntegrationPanel } from '@/components/del/integration-panel'

export default function DeliveryIntegrationPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">데이터 연동</h1>
      <IntegrationPanel />
    </div>
  )
}
