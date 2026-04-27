import { AliasBulkImportCard } from '@/components/sh/shipping/alias-bulk-import-card'

export default function SellerHubSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">설정</h1>
        <p className="text-sm text-muted-foreground">브랜드 운영 설정을 관리합니다</p>
      </div>
      <p className="text-sm text-muted-foreground">
        가격 시뮬레이션 기본값은 [가격 시뮬레이션] 화면 상단의 [기본값] 버튼에서 설정하세요.
      </p>
      <AliasBulkImportCard />
    </div>
  )
}
