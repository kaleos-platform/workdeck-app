import { MappingPresetsManager } from '@/components/finance/mapping-presets-manager'

export default function FinanceMappingRulesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">매핑 규칙 관리</h1>
        <p className="text-sm text-muted-foreground">
          업로드 파일의 컬럼 매핑을 기억해 두는 규칙입니다 — 파일 이름이 아니라 파일 형식(헤더
          구성)으로 인식합니다
        </p>
      </div>
      <MappingPresetsManager />
    </div>
  )
}
