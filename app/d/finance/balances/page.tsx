import { FinanceBalancesManager } from '@/components/finance/balances-manager'

export default function FinanceBalancesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">계좌 관리</h1>
        <p className="text-sm text-muted-foreground">
          보유 계좌·부채와 자산·부채 계정과목을 관리합니다
        </p>
      </div>
      <FinanceBalancesManager />
    </div>
  )
}
