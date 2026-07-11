import { Suspense } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { FINANCE_UPLOAD_PATH } from '@/lib/deck-routes'
import { TransactionsView } from '@/components/finance/transactions-view'

export default function FinanceTransactionsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">거래 내역</h1>
          <p className="text-sm text-muted-foreground">데이터 확인 · 계정과목 분류 · 중복 처리</p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href={FINANCE_UPLOAD_PATH}>데이터 등록</Link>
        </Button>
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
