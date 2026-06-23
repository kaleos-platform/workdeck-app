import { DashboardView } from '@/components/finance/dashboard-view'

export default function FinanceDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">요약 대시보드</h1>
        <p className="text-sm text-muted-foreground">현금흐름 · 재무상태를 한눈에 파악합니다</p>
      </div>
      <DashboardView />
    </div>
  )
}
