import { FinanceAccountsManager } from '@/components/finance/accounts-manager'

export default function FinanceAccountsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">운영 계정 관리</h1>
        <p className="text-sm text-muted-foreground">
          운영 계정 항목 · 자동 분류 규칙 · 회계용(K-IFRS) 내보내기
        </p>
      </div>
      <FinanceAccountsManager />
    </div>
  )
}
