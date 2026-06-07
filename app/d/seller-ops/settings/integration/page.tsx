'use client'

import { IntegrationCatalog } from '@/components/sh/settings/integration-catalog'
import { CredentialForm } from '@/components/settings/credential-form'
import { SalesCollectionHistory } from '@/components/sh/settings/sales-collection-history'

export default function SettingsIntegrationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">데이터 연동</h1>
        <p className="text-sm text-muted-foreground">
          다른 Deck·외부 데이터 연동을 설정하고 관리합니다
        </p>
      </div>

      {/* ── 연동 관리 (상단) ── */}
      {/* 쿠팡 계정 연동 — 계정에 존속(1계정 1워크스페이스)되며 쿠팡 광고 관리자와 공유된다.
          여기서 먼저 설정하면 워크스페이스가 자동 생성되고 쿠팡 광고 Deck 에서도 사용된다. */}
      <CredentialForm />

      <IntegrationCatalog />

      {/* ── 수집 이력 (하단) ── */}
      {/* 판매(VENDOR) 수집·변환 이력 + 상시 재백필 버튼 (콜드스타트/재실행 통합) */}
      <SalesCollectionHistory />
    </div>
  )
}
