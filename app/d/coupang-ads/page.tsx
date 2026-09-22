import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { UploadCloud } from 'lucide-react'
import { resolveWorkspace } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { DashboardClient, type InitialDashboardData } from '@/components/dashboard/dashboard-client'
import { COUPANG_ADS_UPLOAD_PATH } from '@/lib/deck-routes'
import { getDaysAgoStrKst } from '@/lib/date-range'
import { queryCampaigns, queryKpi } from '@/lib/coupang-ads/queries'

export default async function CoupangAdsHomePage() {
  const resolved = await resolveWorkspace()
  if (resolved.error) {
    if (resolved.error.status === 401) redirect('/login')
    if (resolved.error.status === 404) redirect('/workspace-setup')
    redirect('/my-deck')
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: resolved.workspace.id },
    select: { id: true, name: true },
  })
  if (!workspace) redirect('/workspace-setup')

  const from = getDaysAgoStrKst(7)
  const to = getDaysAgoStrKst(1)
  let initialData: InitialDashboardData | undefined
  try {
    const [kpi, campaigns] = await Promise.all([
      queryKpi(workspace.id, { startDate: from, endDate: to }),
      queryCampaigns(workspace.id, { startDate: from, endDate: to }),
    ])
    initialData = {
      from,
      to,
      kpi,
      campaigns: campaigns.filter(
        (campaign): campaign is typeof campaign & InitialDashboardData['campaigns'][number] =>
          'metrics' in campaign && 'prevMetrics' in campaign
      ),
    }
  } catch {
    // 서버 초기 조회 실패는 기존 클라이언트 조회로 재시도한다.
  }
  const hasData = initialData
    ? initialData.campaigns.length > 0
    : Boolean(
        await prisma.adRecord.findFirst({
          where: { workspaceId: workspace.id },
          select: { id: true },
        })
      )

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">쿠팡 광고 관리</h1>
          <p className="text-sm text-muted-foreground">
            {workspace.name} 계정의 광고 성과를 분석합니다.
          </p>
        </div>
        <Link href={COUPANG_ADS_UPLOAD_PATH}>
          <Button className="gap-2">
            <UploadCloud className="h-4 w-4" />
            리포트 업로드
          </Button>
        </Link>
      </div>

      <DashboardClient hasData={hasData} initialData={initialData} />
    </div>
  )
}
