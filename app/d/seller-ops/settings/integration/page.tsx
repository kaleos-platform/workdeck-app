'use client'

import { IntegrationCatalog } from '@/components/sh/settings/integration-catalog'

export default function SettingsIntegrationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">데이터 연동</h1>
        <p className="text-sm text-muted-foreground">
          다른 Deck·외부 데이터 연동을 설정하고 관리합니다
        </p>
      </div>
      <IntegrationCatalog />
    </div>
  )
}
