import { Suspense } from 'react'
import { TransactionsView } from '@/components/finance/transactions-view'

export default function FinanceTransactionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">거래 내역</h1>
        <p className="text-sm text-muted-foreground">데이터 확인 · 계정과목 분류 · 중복 처리</p>
      </div>
      <Suspense
        fallback={
          <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground shadow-sm">
            불러오는 중...
          </div>
        }
      >
        <TransactionsView />
      </Suspense>
    </div>
  )
}
