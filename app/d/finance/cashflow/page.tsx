import { FinanceCashflowView } from '@/components/finance/cashflow-view'

export default function FinanceCashflowPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">현금흐름 상세</h1>
        <p className="text-sm text-muted-foreground">계정과목 · 그룹별 수입·지출 추이</p>
      </div>
      <FinanceCashflowView />
    </div>
  )
}
