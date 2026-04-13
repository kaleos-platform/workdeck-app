'use client'

import { SettingsPanel } from '@/components/inv/settings-panel'

export default function InventorySettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">재고 관리 설정</h1>
        <p className="text-sm text-muted-foreground">
          통합 재고 관리 덱의 기본값과 알림을 설정합니다.
        </p>
      </div>
      <SettingsPanel />
    </div>
  )
}
