'use client'

import { IntegrationCatalog } from '@/components/sh/settings/integration-catalog'
import { CredentialForm } from '@/components/settings/credential-form'
import { BackfillPrompt } from '@/components/settings/backfill-prompt'

export default function SettingsIntegrationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">데이터 연동</h1>
        <p className="text-sm text-muted-foreground">
          다른 Deck·외부 데이터 연동을 설정하고 관리합니다
        </p>
      </div>

      {/* 쿠팡 계정 연동 — 계정에 존속(1계정 1워크스페이스)되며 쿠팡 광고 관리자와 공유된다.
          여기서 먼저 설정하면 워크스페이스가 자동 생성되고 쿠팡 광고 Deck 에서도 사용된다. */}
      <CredentialForm />

      {/* 콜드스타트 백필 — VENDOR 판매 데이터가 없을 때 과거 데이터 수집 안내 */}
      <BackfillPrompt />

      <IntegrationCatalog />
    </div>
  )
}
