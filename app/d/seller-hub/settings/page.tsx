import { PricingSettingsForm } from '@/components/sh/settings/pricing-settings-form'
import { AliasBulkImportCard } from '@/components/sh/shipping/alias-bulk-import-card'

export default function SellerHubSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">설정</h1>
        <p className="text-sm text-muted-foreground">브랜드 운영 설정을 관리합니다</p>
      </div>
      <PricingSettingsForm />
      <AliasBulkImportCard />
    </div>
  )
}
