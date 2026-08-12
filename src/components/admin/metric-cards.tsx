import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import type { AdminMetrics } from '@/lib/admin/metrics'

// 대시보드 KPI 카드 6개 — 서버 컴포넌트, 프레젠테이션 전용 (패턴: billing-dashboard.tsx)
function formatKrw(n: number) {
  return `${n.toLocaleString('ko-KR')}원`
}

export function MetricCards({ metrics }: { metrics: AdminMetrics }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>신규 가입자</CardDescription>
          <CardTitle className="text-2xl tabular-nums">{metrics.newUsers7d}명</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">최근 7일</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>전체 사용자</CardDescription>
          <CardTitle className="text-2xl tabular-nums">{metrics.totalUsers}명</CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>누적 유료 사용자</CardDescription>
          <CardTitle className="text-2xl tabular-nums">{metrics.paidUsersCumulative}명</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">
            유료 결제 이력이 있는 Space 소속(탈퇴자 제외) · 현재 유료 {metrics.paidUsersCurrent}명
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>신규 결제 금액</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {formatKrw(metrics.newRevenue7dAmount)}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">최근 7일 · VAT 포함</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>MRR</CardDescription>
          <CardTitle className="text-2xl tabular-nums">{formatKrw(metrics.mrr.actualSupply)}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">
            VAT 포함 {formatKrw(metrics.mrr.actualAmount)} · 잠재{' '}
            {formatKrw(metrics.mrr.potentialSupply)}(활성 deck 기준, 면제 포함)
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>ARR</CardDescription>
          <CardTitle className="text-2xl tabular-nums">{formatKrw(metrics.arr.actualSupply)}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">
            VAT 포함 {formatKrw(metrics.arr.actualAmount)} · 잠재{' '}
            {formatKrw(metrics.arr.potentialSupply)}(활성 deck 기준, 면제 포함)
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
