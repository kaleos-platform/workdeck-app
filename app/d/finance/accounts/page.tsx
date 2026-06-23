import { FinanceAccountsManager } from '@/components/finance/accounts-manager'

export default function FinanceAccountsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">계정과목 관리</h1>
        <p className="text-sm text-muted-foreground">
          K-IFRS 표준 계정과목 · 사용자 하위 계정 · 자동 분류 규칙
        </p>
      </div>
      <FinanceAccountsManager />
    </div>
  )
}
