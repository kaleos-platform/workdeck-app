import { BalanceTrendView } from '@/components/finance/balance-trend-view'

export default function FinanceBalanceTrendPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">잔액 추이</h1>
        <p className="text-sm text-muted-foreground">월말 현금 · 부채 · 순자산 변화를 추적합니다</p>
      </div>
      <BalanceTrendView />
    </div>
  )
}
